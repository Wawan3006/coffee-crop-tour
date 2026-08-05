// ============================================================================
// local-store.js — Replace Local Storage (Step: "Replace Local Storage").
//
// Drop-in synchronous replacement for window.localStorage's getItem/setItem/
// removeItem, used everywhere the app previously read/wrote localStorage
// directly (auth.js session, api.js server URL + JWT token, sync.js device
// id). Call sites keep the EXACT same synchronous get/set/remove shape --
// only the underlying persistence changes, so no other file's logic or the
// frontend UI needs to change.
//
// Why replace it:
//   - localStorage is per-origin, synchronous-blocking, ~5-10MB capped, and
//     has no transactional guarantees -- fine for 3 tiny string keys, but it
//     is a second, separate persistence mechanism from the rest of the app's
//     offline data (IndexedDB via db.js), which complicates backup/restore,
//     "export my data", and multi-store transactional writes.
//   - Consolidating ALL persistent client state into IndexedDB (one storage
//     engine, one place to reason about durability/quota/versioning) is the
//     point of this module.
//
// How it works:
//   - An in-memory Map is the synchronous source of truth for the lifetime
//     of the page (so getItem() can stay synchronous, matching every
//     existing call site's expectations).
//   - init() (called once, early, from App.init()) hydrates that Map from
//     IndexedDB's `localStore` object store (see js/db.js), and -- exactly
//     once, guarded by a migrated flag written back into IndexedDB itself --
//     migrates any pre-existing window.localStorage values for the known
//     legacy keys so upgrading users don't get logged out / lose their
//     configured server URL when this ships.
//   - setItem()/removeItem() update the in-memory Map immediately (so the
//     very next synchronous getItem() call sees the new value, exactly like
//     real localStorage) AND persist to IndexedDB in the background.
//   - window.localStorage itself is never written to going forward; legacy
//     values are read once for migration purposes only, then left alone.
// ============================================================================

const LocalStore = (() => {
  const cache = new Map();
  let ready = false;
  let readyPromise = null;

  // Every key this app used to store directly in window.localStorage.
  // Kept in one place so migration + future audits are easy.
  const LEGACY_KEYS = ['cct_session', 'cct_device_id', 'cct_api_base_url', 'cct_api_token'];

  async function migrateLegacyLocalStorageOnce() {
    const migratedFlag = await DB.get('localStore', '__migrated_from_localStorage__');
    if (migratedFlag) return;
    try {
      for (const key of LEGACY_KEYS) {
        const legacyVal = window.localStorage ? window.localStorage.getItem(key) : null;
        if (legacyVal !== null && legacyVal !== undefined && !cache.has(key)) {
          cache.set(key, legacyVal);
          await DB.putLocalStore(key, legacyVal);
        }
      }
    } catch (e) {
      // localStorage may be unavailable (privacy mode, disabled cookies, etc.)
      // -- migration is best-effort only, never fatal.
      console.warn('LocalStore: legacy localStorage migration skipped:', e);
    }
    await DB.putLocalStore('__migrated_from_localStorage__', true);
  }

  async function init() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const rows = await DB.getAllLocalStore();
      rows.forEach(r => cache.set(r.key, r.value));
      await migrateLegacyLocalStorageOnce();
      ready = true;
    })();
    return readyPromise;
  }

  function getItem(key) {
    if (!ready) {
      // init() hasn't resolved yet (e.g. a call site ran before App.init()
      // awaited LocalStore.init()). Fall back to legacy localStorage so
      // behavior degrades gracefully rather than silently returning null.
      try { return window.localStorage ? window.localStorage.getItem(key) : null; } catch (e) { return null; }
    }
    return cache.has(key) ? cache.get(key) : null;
  }

  function setItem(key, value) {
    cache.set(key, value);
    ready = true; // a set implies the cache is at least locally authoritative for this key
    DB.putLocalStore(key, value).catch(e => console.warn('LocalStore.setItem persist failed:', e));
  }

  function removeItem(key) {
    cache.delete(key);
    DB.deleteLocalStore(key).catch(e => console.warn('LocalStore.removeItem persist failed:', e));
  }

  return { init, getItem, setItem, removeItem, get isReady() { return ready; } };
})();
