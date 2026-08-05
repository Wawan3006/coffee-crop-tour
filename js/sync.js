// ============================================================================
// sync.js -- offline-first sync engine (Step 2, 3, 8, 24, 25, plus:
// Offline Queue, Conflict Resolution, Retry, Duplicate detection,
// Sync history, Background synchronization).
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
// SYNCED | SYNC_ERROR | CONFLICT (stored lowercase internally for
// backward-compat with existing IndexedDB records: 'draft' | 'waiting_sync' |
// 'syncing' | 'synced' | 'sync_error' | 'conflict').
//
// ---- Offline Queue ----
// Every draft/pending/error/conflict record lives in the IndexedDB `drafts`
// store (js/db.js) -- that store IS the offline queue. getQueue() exposes it
// pre-sorted/grouped for the Sync Center UI (js/sync-center.js). Nothing new
// to persist here; this section just formalizes read access to the queue
// that queueForSync()/saveDraft() already populate.
//
// ---- Duplicate detection ----
// checkDuplicate() runs BEFORE a record is queued for sync: a local check
// (same farmer + survey date + crop year among other drafts/synced surveys,
// works fully offline) always runs, and -- when a central server is
// configured and reachable -- the authoritative server-side check
// (POST /api/analytics/duplicate-check/survey, backend/services/
// duplicate_service.py) is also consulted. Duplicates are FLAGGED
// (duplicateWarning / duplicateCheck fields on the record) for the surveyor
// to see and consciously confirm, never silently blocked or auto-deleted --
// consistent with how the rest of this app treats data-quality issues.
//
// ---- Conflict Resolution ----
// A CONFLICT result from the server (existing.local_updated_at newer than
// this device's copy, backend/sync.py upsert_survey()) now gets its own
// 'conflict' status distinct from 'sync_error', with the server's version
// captured on the record. resolveConflict() lets the user choose to keep
// their local edit (re-submitted with a bumped version_number so it wins
// the next sync) or discard it (record removed from the local queue).
//
// ---- Retry ----
// Failed records get retryCount incremented and a nextRetryAt computed with
// exponential backoff (30s, 60s, 120s, 240s... capped at 30 min) so a flaky
// connection doesn't hammer the server every 45s forever. retryNow() lets
// the surveyor force an immediate retry bypassing backoff.
//
// ---- Sync History ----
// Every syncAll() run (whether it moved 0 or 50 records) writes one row to
// IndexedDB's `syncHistory` store via DB.addSyncHistory() -- timestamp,
// trigger (manual/auto/online-event/background-sync), mode (api/simulation),
// and attempted/synced/failed/conflict/duplicate counts. getSyncHistory()
// reads it back for the Sync Center UI.
//
// ---- Background synchronization ----
// In addition to the original 45s online-polling timer (kept as a universal
// fallback, since iOS Safari has no Background Sync API), queueForSync()
// registers a 'cct-sync' tag with the browser's SyncManager
// (see service-worker.js) when available, so the OS/browser can wake the
// service worker to flush the queue even if the app itself isn't in the
// foreground. The service worker's 'sync' handler posts a message back to
// any open app window/tab, which triggers syncAll() here (see init()'s
// serviceWorker message listener) -- IndexedDB access stays inside the page
// context, the service worker only acts as the wake-up trigger.
// ============================================================================

const Sync = (() => {
  let listeners = [];
  let syncing = false;

  const BACKOFF_BASE_MS = 30 * 1000;      // 30s
  const BACKOFF_MAX_MS = 30 * 60 * 1000;  // 30 min
  const DUPLICATE_WINDOW_DAYS = 3;

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

  function isOnline() { return navigator.onLine; }

  function getDeviceId() {
    let id = LocalStore.getItem('cct_device_id');
    if (!id) {
      id = 'DEVICE-' + Utils.uid('').slice(1);
      LocalStore.setItem('cct_device_id', id);
    }
    return id;
  }

  // ---- Background synchronization: ask the browser to wake us up later ----
  async function registerBackgroundSync() {
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('cct-sync');
        return true;
      }
    } catch (e) {
      console.warn('Background Sync registration failed (will rely on 45s polling + online event):', e);
    }
    return false;
  }

  // ---- Duplicate detection ----
  // Local, fully-offline check: same farmer + same crop year + survey date
  // within DUPLICATE_WINDOW_DAYS among other drafts/synced surveys on this
  // device. Always runs, even with no server configured.
  async function checkDuplicateLocal(survey) {
    if (!survey.farmerId) return null;
    const [drafts, synced] = await Promise.all([DB.getAll('drafts'), DB.getAll('surveys')]);
    const others = drafts.concat(synced).filter(s => s.id !== survey.id && s.farmerId === survey.farmerId);
    if (!others.length) return null;
    const targetDate = survey.surveyDate ? new Date(survey.surveyDate).getTime() : null;
    const matches = others.filter(o => {
      if (String(o.cropYear) !== String(survey.cropYear)) return false;
      if (targetDate === null || !o.surveyDate) return true; // no date to compare -- still a same-farmer/same-crop-year match
      const days = Math.abs(new Date(o.surveyDate).getTime() - targetDate) / 86400000;
      return days <= DUPLICATE_WINDOW_DAYS;
    });
    if (!matches.length) return null;
    return {
      is_duplicate: true,
      matched_survey_ids: matches.map(m => m.id),
      detail: `Local check: ${matches.length} existing survey(s) for this farmer in ${survey.cropYear} within ${DUPLICATE_WINDOW_DAYS} days.`,
      source: 'local',
    };
  }

  // Authoritative server-side check (backend/services/duplicate_service.py),
  // consulted in addition to the local check when a central server is
  // reachable. Never throws -- a failed/unreachable check just means we fall
  // back to the local-only result.
  async function checkDuplicateServer(survey) {
    if (!Api.isConfigured()) return null;
    try {
      const resp = await Api.analyticsDuplicateCheckSurvey({
        farmer_id: survey.farmerId || null,
        crop_year: survey.cropYear ? String(survey.cropYear) : null,
        survey_date: survey.surveyDate || null,
        exclude_survey_id: survey.id,
        window_days: DUPLICATE_WINDOW_DAYS,
      });
      return resp ? { ...resp, source: 'server' } : null;
    } catch (e) {
      console.warn('Server duplicate-check failed, using local result only:', e);
      return null;
    }
  }

  async function checkDuplicate(survey) {
    const [local, server] = await Promise.all([checkDuplicateLocal(survey), checkDuplicateServer(survey)]);
    // Prefer the authoritative server result when it responded; otherwise fall back to local.
    return server || local;
  }

  // ---- Offline Queue: save / enqueue ----
  async function queueForSync(survey) {
    const dup = await checkDuplicate(survey).catch(() => null);
    survey.duplicateCheck = dup && dup.is_duplicate ? dup : null;
    survey.status = 'waiting_sync'; // PENDING_SYNC
    survey.updatedAt = Utils.nowIso();
    survey.retryCount = 0;
    survey.nextRetryAt = null;
    await DB.put('drafts', survey);
    emit();
    if (isOnline()) {
      syncAll({ trigger: 'queue' });
    } else {
      await registerBackgroundSync();
    }
    return survey;
  }

  async function saveDraft(survey) {
    survey.status = 'draft'; // DRAFT
    survey.updatedAt = Utils.nowIso();
    await DB.put('drafts', survey);
    emit();
    return survey;
  }

  // Read-only view of the offline queue, grouped for the Sync Center UI.
  async function getQueue() {
    const drafts = (await DB.getAll('drafts')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return {
      all: drafts,
      draft: drafts.filter(d => d.status === 'draft'),
      waiting_sync: drafts.filter(d => d.status === 'waiting_sync'),
      syncing: drafts.filter(d => d.status === 'syncing'),
      sync_error: drafts.filter(d => d.status === 'sync_error'),
      conflict: drafts.filter(d => d.status === 'conflict'),
      duplicatesFlagged: drafts.filter(d => d.duplicateCheck && d.duplicateCheck.is_duplicate),
    };
  }

  async function getPendingCounts() {
    const drafts = await DB.getAll('drafts');
    return {
      draft: drafts.filter(d => d.status === 'draft').length,
      waiting_sync: drafts.filter(d => d.status === 'waiting_sync').length,
      sync_error: drafts.filter(d => d.status === 'sync_error').length,
      conflict: drafts.filter(d => d.status === 'conflict').length,
      syncing: drafts.filter(d => d.status === 'syncing').length,
      duplicatesFlagged: drafts.filter(d => d.duplicateCheck && d.duplicateCheck.is_duplicate).length,
      total: drafts.length,
    };
  }

  // ---- Retry (exponential backoff) ----
  function computeBackoffMs(retryCount) {
    return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, retryCount - 1)));
  }

  function isDueForRetry(d, now) {
    if (d.status !== 'sync_error') return true; // waiting_sync/conflict-resolved records are always due
    if (!d.nextRetryAt) return true;
    return new Date(d.nextRetryAt).getTime() <= now;
  }

  // Force an immediate retry of one record (or all sync_error/waiting_sync
  // records if no id given), bypassing backoff.
  async function retryNow(id) {
    const drafts = await DB.getAll('drafts');
    const targets = id ? drafts.filter(d => d.id === id) : drafts.filter(d => d.status === 'sync_error' || d.status === 'waiting_sync');
    for (const d of targets) {
      d.nextRetryAt = null;
      await DB.put('drafts', d);
    }
    return syncAll({ trigger: 'manual-retry', force: true });
  }

  // ---- Conflict Resolution ----
  // resolution: 'keep_local' (resubmit local copy so it wins next sync) or
  // 'discard_local' (drop the local copy, deferring to the server's version).
  async function resolveConflict(id, resolution) {
    const d = await DB.get('drafts', id);
    if (!d) return null;
    const user = Auth.currentUser();
    if (resolution === 'discard_local') {
      await DB.del('drafts', id);
      await DB.logAudit(user, 'CONFLICT_RESOLVED', 'survey', id, 'Discarded local copy in favor of server version.');
      emit();
      return { id, resolution };
    }
    // keep_local: bump version_number past whatever the server reported so
    // this device's copy wins the conflict-check on the next sync attempt.
    const serverVersion = d.conflictServerVersion || 1;
    d.versionNumber = Math.max((d.versionNumber || 1), serverVersion) + 1;
    d.status = 'waiting_sync';
    d.conflictServerVersion = null;
    d.conflictMessage = null;
    d.retryCount = 0;
    d.nextRetryAt = null;
    d.updatedAt = Utils.nowIso();
    await DB.put('drafts', d);
    await DB.logAudit(user, 'CONFLICT_RESOLVED', 'survey', id, 'Kept local copy; re-queued for sync with bumped version.');
    emit();
    if (isOnline()) syncAll({ trigger: 'conflict-resolution' });
    return { id, resolution };
  }

  // ---- Real backend sync (Step 3, 7, 8, 24) ----
  async function syncViaApi(toSync) {
    let synced = 0, failed = 0, conflicts = 0;
    const user = Auth.currentUser();
    const deviceId = getDeviceId();

    // Batch upload (Step 7: "preferably allow multiple records in one request").
    const payload = toSync.map(d => Object.assign(Api.toApiSurveyPayload(d), {
      version_number: d.versionNumber || 1,
    }));
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
          d.retryCount = 0;
          d.nextRetryAt = null;
          await DB.put('surveys', d);
          await DB.del('drafts', d.id);
          await DB.logAudit(user, 'SYNC_SUCCESS', 'survey', d.id, `Synced to central database (${result.result})`);
          synced++;
        } else if (result && result.result === 'CONFLICT') {
          d.status = 'conflict'; // CONFLICT (distinct from sync_error -- needs a decision, not just a retry)
          d.conflictMessage = result.message || 'Server has a newer version of this record.';
          d.conflictServerVersion = result.version_number || (d.versionNumber || 1) + 1;
          await DB.put('drafts', d);
          await DB.logAudit(user, 'SYNC_CONFLICT', 'survey', d.id, d.conflictMessage);
          conflicts++;
        } else {
          d.status = 'sync_error'; // SYNC_ERROR
          d.syncError = (result && result.message) || 'Server rejected this record.';
          d.retryCount = (d.retryCount || 0) + 1;
          d.nextRetryAt = new Date(Date.now() + computeBackoffMs(d.retryCount)).toISOString();
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
        d.retryCount = (d.retryCount || 0) + 1;
        d.nextRetryAt = new Date(Date.now() + computeBackoffMs(d.retryCount)).toISOString();
        await DB.put('drafts', d);
        failed++;
      }
    }
    return { synced, failed, conflicts };
  }

  // ---- Local-only simulated sync (original behavior, zero backend needed) ----
  async function syncViaSimulation(toSync) {
    let synced = 0, failed = 0, conflicts = 0;
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
        d.retryCount = 0;
        d.nextRetryAt = null;
        await DB.put('surveys', d);
        await DB.del('drafts', d.id);
        await DB.logAudit(user, 'SYNC_SUCCESS', 'survey', d.id, 'Synced from offline queue (local simulation -- no backend configured)');
        synced++;
      } else {
        d.status = 'sync_error';
        d.syncError = 'Network interrupted during upload. Will retry automatically.';
        d.retryCount = (d.retryCount || 0) + 1;
        d.nextRetryAt = new Date(Date.now() + computeBackoffMs(d.retryCount)).toISOString();
        await DB.put('drafts', d);
        await DB.logAudit(user, 'SYNC_ERROR', 'survey', d.id, d.syncError);
        failed++;
      }
      emit();
    }
    return { synced, failed, conflicts };
  }

  // trigger: 'manual' | 'auto' | 'online-event' | 'background-sync' |
  //          'queue' | 'manual-retry' | 'conflict-resolution'
  async function syncAll(opts = {}) {
    const trigger = opts.trigger || 'manual';
    if (syncing || !isOnline()) return { synced: 0, failed: 0, conflicts: 0, skipped: true };
    syncing = true;
    let result = { synced: 0, failed: 0, conflicts: 0 };
    const startedAt = Utils.nowIso();
    let mode = 'simulation';
    let attempted = 0;
    try {
      const drafts = await DB.getAll('drafts');
      const now = Date.now();
      const eligible = drafts.filter(d => d.status === 'waiting_sync' || d.status === 'sync_error');
      const toSync = opts.force ? eligible : eligible.filter(d => isDueForRetry(d, now));
      attempted = toSync.length;
      if (toSync.length === 0) return result;

      toSync.forEach(d => { d.status = 'syncing'; });
      for (const d of toSync) await DB.put('drafts', d);
      emit();

      if (Api.isConfigured()) {
        mode = 'api';
        result = await syncViaApi(toSync);
      } else {
        mode = 'simulation';
        result = await syncViaSimulation(toSync);
      }
    } finally {
      syncing = false;
      // ---- Sync History: record every run, success or failure ----
      try {
        await DB.addSyncHistory({
          id: Utils.uid('SYNCHIST'),
          ts: startedAt,
          finishedAt: Utils.nowIso(),
          trigger, mode,
          deviceId: getDeviceId(),
          attempted,
          synced: result.synced || 0,
          failed: result.failed || 0,
          conflicts: result.conflicts || 0,
        });
      } catch (e) { console.warn('Failed to write sync history entry:', e); }
      emit();
    }
    return result;
  }

  async function getSyncHistory(limit = 50) {
    return DB.getSyncHistory(limit);
  }

  function init() {
    window.addEventListener('online', () => { syncAll({ trigger: 'online-event' }); emit(); });
    window.addEventListener('offline', () => emit());
    // Universal fallback: periodic auto-retry every 45s if online (Step 24:
    // "Never delete the local survey immediately after synchronization...
    // Retry if failed"). Kept alongside native Background Sync (below)
    // because Background Sync isn't supported on every browser (notably
    // iOS Safari), so this polling timer is what guarantees retry there.
    setInterval(() => { if (isOnline()) syncAll({ trigger: 'auto' }); }, 45000);

    // Background synchronization: the service worker's 'sync' event handler
    // (service-worker.js) can't reach this page's IndexedDB directly, so it
    // posts a message back to any open client asking it to flush the queue.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'CCT_BACKGROUND_SYNC') {
          syncAll({ trigger: 'background-sync' });
        }
      });
    }
  }

  return {
    onChange, isOnline, queueForSync, saveDraft, getPendingCounts, syncAll, init,
    getDeviceId, getQueue, checkDuplicate, retryNow, resolveConflict, getSyncHistory,
    registerBackgroundSync,
    get isSyncing() { return syncing; },
  };
})();
