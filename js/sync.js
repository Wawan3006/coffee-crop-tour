// ============================================================================
// sync.js — offline-first sync engine.
// Drafts have status: 'draft' | 'waiting_sync' | 'sync_error' | 'syncing'
// When online, "syncs" pending items into the 'surveys' store (simulating a
// central DB push) with simulated latency/occasional failure for realism.
// ============================================================================

const Sync = (() => {
  let listeners = [];
  let syncing = false;

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

  function isOnline() { return navigator.onLine; }

  async function queueForSync(survey) {
    survey.status = 'waiting_sync';
    survey.updatedAt = Utils.nowIso();
    await DB.put('drafts', survey);
    emit();
    if (isOnline()) syncAll();
    return survey;
  }

  async function saveDraft(survey) {
    survey.status = 'draft';
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

  async function syncAll() {
    if (syncing || !isOnline()) return { synced: 0, failed: 0 };
    syncing = true;
    let synced = 0, failed = 0;
    try {
      const drafts = await DB.getAll('drafts');
      const toSync = drafts.filter(d => d.status === 'waiting_sync' || d.status === 'sync_error');
      for (const d of toSync) {
        d.status = 'syncing';
        await DB.put('drafts', d);
        emit();
        // simulate network round-trip
        await new Promise(r => setTimeout(r, 350 + Math.random() * 400));
        const ok = Math.random() > 0.04; // ~96% success rate simulation
        if (ok) {
          d.status = 'synced';
          d.syncedAt = Utils.nowIso();
          await DB.put('surveys', d);
          await DB.del('drafts', d.id);
          const user = Auth.currentUser();
          await DB.logAudit(user, 'SYNC_SUCCESS', 'survey', d.id, `Synced from offline queue`);
          synced++;
        } else {
          d.status = 'sync_error';
          d.syncError = 'Network interrupted during upload. Will retry automatically.';
          await DB.put('drafts', d);
          const user = Auth.currentUser();
          await DB.logAudit(user, 'SYNC_ERROR', 'survey', d.id, d.syncError);
          failed++;
        }
        emit();
      }
    } finally {
      syncing = false;
      emit();
    }
    return { synced, failed };
  }

  function init() {
    window.addEventListener('online', () => { syncAll(); emit(); });
    window.addEventListener('offline', () => emit());
    // periodic auto-retry every 45s if online
    setInterval(() => { if (isOnline()) syncAll(); }, 45000);
  }

  return { onChange, isOnline, queueForSync, saveDraft, getPendingCounts, syncAll, init, get isSyncing() { return syncing; } };
})();
