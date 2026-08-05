// ============================================================================
// sync-center.js — "Sync Center" screen: Offline Queue, Conflict Resolution,
// Retry, Duplicate detection warnings, Sync History, Background
// synchronization status. Pure UI layer -- all actual logic lives in
// js/sync.js; this module only renders Sync's data and wires up buttons to
// Sync's exported functions. Reached via the new '#/sync-center' route
// (js/app.js ROUTES) and the "🗂️ Offline Queue & Sync Center" button on the
// Home dashboard -- does not touch/replace any existing screen.
// ============================================================================

const SyncCenter = (() => {
  let activeTab = 'queue'; // 'queue' | 'conflicts' | 'history'
  let ctx = { toast: () => {}, navigate: () => {} };

  function fmtDt(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }

  function tabsHtml() {
    const tabs = [
      { id: 'queue', label: '📥 Offline Queue' },
      { id: 'conflicts', label: '⚠️ Conflicts' },
      { id: 'history', label: '🕒 Sync History' },
    ];
    return `<div class="sync-center-tabs">
      ${tabs.map(t => `<button class="sync-center-tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>`;
  }

  function backgroundSyncPillHtml() {
    const supported = ('serviceWorker' in navigator) && ('SyncManager' in window);
    return `<span class="bg-sync-pill ${supported ? 'on' : 'off'}">
      ${supported ? '🔁 Background Sync active' : '⏱️ Polling fallback (45s) -- Background Sync API unsupported on this browser'}
    </span>`;
  }

  function queueRowHtml(d) {
    const dup = d.duplicateCheck && d.duplicateCheck.is_duplicate;
    const retryInfo = d.status === 'sync_error' && d.nextRetryAt
      ? `<div class="muted small">Next auto-retry: ${fmtDt(d.nextRetryAt)} (attempt #${d.retryCount || 1})</div>` : '';
    return `<div class="queue-row" data-id="${d.id}">
      <div class="queue-row-head">
        <div><b>${d.farmerId || d.id}</b> — ${d.farmerName || 'Unnamed'} · ${d.province || '—'}</div>
        <span class="status-chip status-${d.status}">${d.status}</span>
      </div>
      <div class="muted small">${d.surveyDate || ''} · Updated ${fmtDt(d.updatedAt)}</div>
      ${d.status === 'sync_error' ? `<div class="muted small">Error: ${d.syncError || 'Unknown error'}</div>` : ''}
      ${retryInfo}
      ${dup ? `<div class="dup-warning">⚠️ Possible duplicate (${d.duplicateCheck.source || 'local'} check): ${d.duplicateCheck.detail || 'Matches an existing survey for this farmer/crop year.'}</div>` : ''}
      <div class="queue-row-actions">
        ${(d.status === 'sync_error' || d.status === 'waiting_sync') ? `<button class="btn-chip" data-action="retry" data-id="${d.id}">🔄 Retry Now</button>` : ''}
        <button class="btn-chip" data-action="edit" data-id="${d.id}">✏️ Edit</button>
      </div>
    </div>`;
  }

  function conflictRowHtml(d) {
    return `<div class="queue-row" data-id="${d.id}">
      <div class="queue-row-head">
        <div><b>${d.farmerId || d.id}</b> — ${d.farmerName || 'Unnamed'}</div>
        <span class="status-chip status-conflict">Conflict</span>
      </div>
      <div class="conflict-box">${d.conflictMessage || 'Server has a newer version of this record.'}</div>
      <div class="queue-row-actions">
        <button class="btn-primary" data-action="keep-local" data-id="${d.id}" style="min-height:36px;padding:8px 14px;">Keep My Version</button>
        <button class="btn-secondary" data-action="discard-local" data-id="${d.id}" style="min-height:36px;padding:8px 14px;">Discard, Use Server's</button>
      </div>
    </div>`;
  }

  function historyRowHtml(h) {
    const icon = h.failed > 0 ? '🔴' : (h.conflicts > 0 ? '🟣' : '🟢');
    return `<div class="history-row">
      <div>
        ${icon} <b>${h.trigger}</b> (${h.mode === 'api' ? 'server' : 'local sim'})
        <div class="muted small">${fmtDt(h.ts)}</div>
      </div>
      <div class="muted small">${h.attempted} attempted · ${h.synced} synced · ${h.failed} failed · ${h.conflicts || 0} conflicts</div>
    </div>`;
  }

  async function render(root, context) {
    ctx = context || ctx;
    const [queue, history] = await Promise.all([Sync.getQueue(), Sync.getSyncHistory(30)]);

    let body = '';
    if (activeTab === 'queue') {
      const rows = queue.all.filter(d => d.status !== 'conflict');
      body = rows.length ? rows.map(queueRowHtml).join('') : '<p class="muted">Offline queue is empty -- everything is synced.</p>';
    } else if (activeTab === 'conflicts') {
      body = queue.conflict.length ? queue.conflict.map(conflictRowHtml).join('')
        : '<p class="muted">No conflicts. 🎉</p>';
    } else {
      body = history.length ? history.map(historyRowHtml).join('') : '<p class="muted">No sync runs recorded yet.</p>';
    }

    root.innerHTML = `
      <div class="card">
        <div class="card-title">Sync Center</div>
        <div class="muted small" style="margin-bottom:8px">
          ${Sync.isOnline() ? '🟢 Online' : '🔴 Offline'} · ${Api.isConfigured() ? 'Central server configured' : 'Local-only mode'} &nbsp;
          ${backgroundSyncPillHtml()}
        </div>
        <div class="sync-status-row">
          <span class="badge badge-waiting">Queued &nbsp;${queue.waiting_sync.length}</span>
          <span class="badge badge-draft">Draft &nbsp;${queue.draft.length}</span>
          <span class="badge badge-error">Errors &nbsp;${queue.sync_error.length}</span>
          <span class="badge badge-conflict">Conflicts &nbsp;${queue.conflict.length}</span>
        </div>
        <div class="queue-row-actions" style="margin-top:10px">
          <button class="btn-primary" id="sc-sync-now" ${!Sync.isOnline() ? 'disabled' : ''}>🔄 Sync Now</button>
          <button class="btn-secondary" id="sc-retry-all" ${!Sync.isOnline() || queue.sync_error.length === 0 ? 'disabled' : ''}>⏩ Retry All Failed</button>
        </div>
      </div>

      <div class="card">
        ${tabsHtml()}
        <div id="sc-body">${body}</div>
      </div>
    `;

    Utils.qsa('.sync-center-tab', root).forEach(btn => {
      btn.addEventListener('click', () => { activeTab = btn.getAttribute('data-tab'); render(root, ctx); });
    });

    const syncNowBtn = document.getElementById('sc-sync-now');
    if (syncNowBtn) syncNowBtn.addEventListener('click', async () => {
      syncNowBtn.disabled = true; syncNowBtn.textContent = '⏳ Syncing...';
      const result = await Sync.syncAll({ trigger: 'manual' });
      ctx.toast(`Sync complete: ${result.synced} synced, ${result.failed} failed, ${result.conflicts || 0} conflicts.`, result.failed ? 'error' : 'info');
      render(root, ctx);
    });

    const retryAllBtn = document.getElementById('sc-retry-all');
    if (retryAllBtn) retryAllBtn.addEventListener('click', async () => {
      retryAllBtn.disabled = true; retryAllBtn.textContent = '⏳ Retrying...';
      const result = await Sync.retryNow();
      ctx.toast(`Retry complete: ${result.synced} synced, ${result.failed} still failing.`, result.failed ? 'error' : 'info');
      render(root, ctx);
    });

    Utils.qsa('[data-action="retry"]', root).forEach(btn => {
      btn.addEventListener('click', async () => {
        await Sync.retryNow(btn.getAttribute('data-id'));
        ctx.toast('Retry attempted.');
        render(root, ctx);
      });
    });
    Utils.qsa('[data-action="edit"]', root).forEach(btn => {
      btn.addEventListener('click', () => ctx.navigate(`#/edit-survey/${btn.getAttribute('data-id')}`));
    });
    Utils.qsa('[data-action="keep-local"]', root).forEach(btn => {
      btn.addEventListener('click', async () => {
        await Sync.resolveConflict(btn.getAttribute('data-id'), 'keep_local');
        ctx.toast('Kept your local version; re-queued for sync.');
        render(root, ctx);
      });
    });
    Utils.qsa('[data-action="discard-local"]', root).forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Discard your local changes and defer to the server\'s version? This cannot be undone.')) return;
        await Sync.resolveConflict(btn.getAttribute('data-id'), 'discard_local');
        ctx.toast('Discarded local copy.');
        render(root, ctx);
      });
    });
  }

  return { render };
})();
