// ============================================================================
// db.js — IndexedDB wrapper (offline-first local storage layer)
// Stores: surveys (synced), drafts (draft/waiting_sync/syncing/synced/
//         sync_error/conflict), photos, adjustments (crop estimate revision
//         history), auditLog, users, meta, localStore (key/value replacement
//         for localStorage -- see js/local-store.js), syncHistory (Sync
//         History feature -- one row per sync run, success or failure).
//
// DB_VERSION 2 (Step: "Replace Local Storage" + Sync History): adds the
// `localStore` and `syncHistory` object stores. onupgradeneeded only CREATES
// stores that don't already exist, so upgrading from version 1 -> 2 on a
// device that already has real survey data is non-destructive -- every
// existing store (surveys, drafts, photos, adjustments, auditLog, users,
// meta) is left completely untouched.
// ============================================================================

const DB = (() => {
  const DB_NAME = 'CoffeeCropTourDB';
  const DB_VERSION = 2;
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('surveys')) db.createObjectStore('surveys', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'photoId' });
        if (!db.objectStoreNames.contains('adjustments')) db.createObjectStore('adjustments', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('auditLog')) db.createObjectStore('auditLog', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'username' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        // ---- New in DB_VERSION 2 ----
        if (!db.objectStoreNames.contains('localStore')) db.createObjectStore('localStore', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('syncHistory')) {
          const sh = db.createObjectStore('syncHistory', { keyPath: 'id' });
          sh.createIndex('by_ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(storeName, mode = 'readonly') {
    return open().then(db => db.transaction(storeName, mode).objectStore(storeName));
  }

  function put(storeName, value) {
    return tx(storeName, 'readwrite').then(store => new Promise((resolve, reject) => {
      const r = store.put(value);
      r.onsuccess = () => resolve(value);
      r.onerror = (e) => reject(e.target.error);
    }));
  }

  function bulkPut(storeName, values) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(storeName, 'readwrite');
      const store = t.objectStore(storeName);
      values.forEach(v => store.put(v));
      t.oncomplete = () => resolve(values.length);
      t.onerror = (e) => reject(e.target.error);
    }));
  }

  function get(storeName, key) {
    return tx(storeName).then(store => new Promise((resolve, reject) => {
      const r = store.get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = (e) => reject(e.target.error);
    }));
  }

  function getAll(storeName) {
    return tx(storeName).then(store => new Promise((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = (e) => reject(e.target.error);
    }));
  }

  function del(storeName, key) {
    return tx(storeName, 'readwrite').then(store => new Promise((resolve, reject) => {
      const r = store.delete(key);
      r.onsuccess = () => resolve(true);
      r.onerror = (e) => reject(e.target.error);
    }));
  }

  function clear(storeName) {
    return tx(storeName, 'readwrite').then(store => new Promise((resolve, reject) => {
      const r = store.clear();
      r.onsuccess = () => resolve(true);
      r.onerror = (e) => reject(e.target.error);
    }));
  }

  function count(storeName) {
    return tx(storeName).then(store => new Promise((resolve, reject) => {
      const r = store.count();
      r.onsuccess = () => resolve(r.result || 0);
      r.onerror = (e) => reject(e.target.error);
    }));
  }

  // ---- Seed initial data on first load ----
  async function ensureSeeded() {
    const n = await count('surveys');
    if (n > 0) return false;
    const seed = (typeof SEED_DATA !== 'undefined') ? SEED_DATA : { surveys: [], provinceRef: [], islands: [], provinces: [], cropYears: [], surveyors: [] };
    await bulkPut('surveys', seed.surveys);
    await put('meta', { key: 'provinceRef', value: seed.provinceRef });
    await put('meta', { key: 'islands', value: seed.islands });
    await put('meta', { key: 'provinces', value: seed.provinces });
    await put('meta', { key: 'cropYears', value: seed.cropYears });
    await put('meta', { key: 'surveyors', value: seed.surveyors });
    await put('meta', { key: 'currentCropYear', value: Math.max(...seed.cropYears) });

    // seed default users if none
    const existingUsers = await getAll('users');
    if (!existingUsers.length) {
      const defaultUsers = [
        { username: 'surveyor1', name: 'Budi Santoso', role: 'Field Surveyor', password: 'demo' },
        { username: 'agronomist1', name: 'Dewi Anggraini', role: 'Agronomist', password: 'demo' },
        { username: 'manager1', name: 'Rudi Hartono', role: 'Manager', password: 'demo' },
        { username: 'admin1', name: 'Siti Nurhaliza', role: 'Administrator', password: 'demo' },
      ];
      await bulkPut('users', defaultUsers);
    }
    return true;
  }

  async function getMeta(key, fallback = null) {
    const rec = await get('meta', key);
    return rec ? rec.value : fallback;
  }
  async function setMeta(key, value) {
    return put('meta', { key, value });
  }

  async function logAudit(user, action, entity, entityId, details = '') {
    const rec = {
      id: Utils.uid('AUD'), ts: Utils.nowIso(),
      user: user ? `${user.name} (${user.role})` : 'system',
      action, entity, entityId, details,
    };
    return put('auditLog', rec);
  }

  // Combined view: all surveys regardless of sync state (synced + drafts/pending/error), for dashboards
  async function getAllSurveysCombined() {
    const [synced, drafts] = await Promise.all([getAll('surveys'), getAll('drafts')]);
    return synced.concat(drafts);
  }

  // ---- localStore: key/value replacement for window.localStorage. See
  // js/local-store.js for the synchronous in-memory-cache wrapper that reads/
  // writes through this store. ----
  async function getAllLocalStore() { return getAll('localStore'); }
  async function putLocalStore(key, value) { return put('localStore', { key, value }); }
  async function deleteLocalStore(key) { return del('localStore', key); }

  // ---- syncHistory: one row per sync run (Sync History feature). ----
  async function addSyncHistory(entry) { return put('syncHistory', entry); }
  async function getSyncHistory(limit = 50) {
    const rows = await getAll('syncHistory');
    return rows.sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, limit);
  }

  return {
    open, put, bulkPut, get, getAll, del, clear, count,
    ensureSeeded, getMeta, setMeta, logAudit, getAllSurveysCombined,
    getAllLocalStore, putLocalStore, deleteLocalStore,
    addSyncHistory, getSyncHistory,
  };
})();
