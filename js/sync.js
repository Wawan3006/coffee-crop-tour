// ============================================================================
// sync.js -- offline-first sync engine (Step 2, 3, 8, 24, 25).
//
// Two modes, chosen automatically:
//   1. Api.isConfigured() === false (default, original behavior preserved):
//      local-only simulated sync, exactly as before -- no backend required,
//      GitHub Pages deployment keeps working standalone.
//   2. Api.isConfigured() === true (a real FastAPI backend URL has been set,
//      see api.js / More menu "Configure Server"): surveys are POSTed to
//      /api/sync in batches. Re-uploading the same survey_id is always safe
//      (idempotent on the server, Step 8) so pressing SYNC NOW repeatedly on
//      a flaky connection can never create duplicates.
//
// Status values match the spec exactly: DRAFT | PENDING_SYNC | SYNCING |
// SYNCED | SYNC_ERROR (stored lowercase internally for backward-compat with
// existing IndexedDB records: 'draft' | 'waiting_sync' | 'syncing' |
// 'synced' | 'sync_error').
// ============================================================================

const Sync = (() => {
  let listeners = [];
  let syncing = false;

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

  function isOnline() { return navigator.onLine; }

  async function queueForSync(survey) {
    survey.status = 'waiting_sync'; // PENDING_SYNC
    survey.updatedAt = Utils.nowIso();
    await DB.put('drafts', survey);
    emit();
    if (isOnline()) syncAll();
    return survey;
  }

  async function saveDraft(survey) {
    survey.status = 'draft'; // DRAFT
    survey.updatedAt = Utils.nowIso();
    await DB.put('drafts', survey);
    emit();
    return survey;
  }

  async function getPendingCounts() {
    const drafts = await DB.getAll('drafts');
    return {
      draft: drafts.filter(d => d.status === 'draft').length,
      waiting_sync: drafts.filter(d => d.status === 'waiting_sync').length,
      sync_error: drafts.filter(d => d.status === 'sync_error').length,
      syncing: drafts.filter(d => d.status === 'syncing').length,
      total: drafts.length,
    };
  }

  function getDeviceId() {
    let id = localStorage.getItem('cct_device_id');
    if (!id) {
      id = 'DEVICE-' + Utils.uid('').slice(1);
      localStorage.setItem('cct_device_id', id);
    }
    return id;
  }

  // ---- Real backend sync (Step 3, 7, 8, 24) ----
  async function syncViaApi(toSync) {
    let synced = 0, failed = 0;
    const user = Auth.currentUser();
    const deviceId = getDeviceId();

    // Batch upload (Step 7: "preferably allow multiple records in one request").
    const payload = toSync.map(Api.toApiSurveyPayload);
    try {
      const resp = await Api.syncBatch(deviceId, user && user.apiUserId, payload);
      const resultsById = {};
      (resp.results || []).forEach(r => { resultsById[r.survey_id] = r; });

      for (const d of toSync) {
        const result = resultsById[d.id];
        if (result && (result.result === 'CREATED' || result.result === 'UPDATED')) {
          d.status = 'synced'; // SYNCED
          d.syncedAt = Utils.nowIso();
          d.dataQualityStatus = result.data_quality_status;
          await DB.put('surveys', d);
          await DB.del('drafts', d.id);
          await DB.logAudit(user, 'SYNC_SUCCESS', 'survey', d.id, `Synced to central database (${result.result})`);
          synced++;
        } else {
          d.status = 'sync_error'; // SYNC_ERROR
          d.syncError = (result && result.message) || 'Server rejected this record.';
          await DB.put('drafts', d);
          await DB.logAudit(user, 'SYNC_ERROR', 'survey', d.id, d.syncError);
          failed++;
        }
      }
    } catch (err) {
      // Whole batch failed (e.g. network drop mid-request) -- mark all as error,
      // safe to retry: server-side idempotency (Step 8) guarantees no duplicates
      // even if some records in this batch actually made it through before the
      // connection dropped.
      for (const d of toSync) {
        d.status = 'sync_error';
        d.syncError = err.message || 'Network error during sync.';
        await DB.put('drafts', d);
        failed++;
      }
    }
    return { synced, failed };
  }

  // ---- Local-only simulated sync (original behavior, zero backend needed) ----
  async function syncViaSimulation(toSync) {
    let synced = 0, failed = 0;
    for (const d of toSync) {
      d.status = 'syncing';
      await DB.put('drafts', d);
      emit();
      await new Promise(r => setTimeout(r, 350 + Math.random() * 400));
      const ok = Math.random() > 0.04;
      const user = Auth.currentUser();
      if (ok) {
        d.status = 'synced';
        d.syncedAt = Utils.nowIso();
        await DB.put('surveys', d);
        await DB.del('drafts', d.id);
        await DB.logAudit(user, 'SYNC_SUCCESS', 'survey', d.id, 'Synced from offline queue (local simulation -- no backend configured)');
        synced++;
      } else {
        d.status = 'sync_error';
        d.syncError = 'Network interrupted during upload. Will retry automatically.';
        await DB.put('drafts', d);
        await DB.logAudit(user, 'SYNC_ERROR', 'survey', d.id, d.syncError);
        failed++;
      }
      emit();
    }
    return { synced, failed };
  }

  async function syncAll() {
    if (syncing || !isOnline()) return { synced: 0, failed: 0 };
    syncing = true;
    let result = { synced: 0, failed: 0 };
    try {
      const drafts = await DB.getAll('drafts');
      const toSync = drafts.filter(d => d.status === 'waiting_sync' || d.status === 'sync_error');
      if (toSync.length === 0) return result;

      toSync.forEach(d => { d.status = 'syncing'; });
      for (const d of toSync) await DB.put('drafts', d);
      emit();

      if (Api.isConfigured()) {
        result = await syncViaApi(toSync);
      } else {
        result = await syncViaSimulation(toSync);
      }
    } finally {
      syncing = false;
      emit();
    }
    return result;
  }

  function init() {
    window.addEventListener('online', () => { syncAll(); emit(); });
    window.addEventListener('offline', () => emit());
    // periodic auto-retry every 45s if online (Step 24: "Never delete the
    // local survey immediately after synchronization... Retry if failed")
    setInterval(() => { if (isOnline()) syncAll(); }, 45000);
  }

  return {
    onChange, isOnline, queueForSync, saveDraft, getPendingCounts, syncAll, init,
    getDeviceId,
    get isSyncing() { return syncing; },
  };
})();
