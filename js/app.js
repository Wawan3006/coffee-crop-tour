// ============================================================================
// app.js — main SPA router + view renderers for Coffee Crop Tour PWA
// Views: login, home dashboard, survey list, new survey wizard, map, compare,
//        forecast, management dashboard, report, export, admin/users
// ============================================================================

const App = (() => {
  const rootEl = () => document.getElementById('app-root');
  let filters = { cropYear: 'all', coffeeType: 'all', island: 'all', province: 'all', district: 'all', subdistrict: 'all', surveyor: 'all', dateFrom: '', dateTo: '' };
  let allSurveys = [];
  let refMeta = {};

  function toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
  }

  async function refreshData() {
    allSurveys = await DB.getAllSurveysCombined();
    refMeta.provinces = await DB.getMeta('provinces', []);
    refMeta.islands = await DB.getMeta('islands', []);
    refMeta.surveyors = await DB.getMeta('surveyors', []);
    refMeta.cropYears = await DB.getMeta('cropYears', []);
    refMeta.provinceRef = await DB.getMeta('provinceRef', []);
    refMeta.currentCropYear = await DB.getMeta('currentCropYear', new Date().getFullYear());
  }

  function applyFilters(list) {
    return list.filter(s => {
      if (filters.cropYear !== 'all' && String(s.cropYear) !== String(filters.cropYear)) return false;
      if (filters.coffeeType !== 'all' && s.coffeeType !== filters.coffeeType) return false;
      if (filters.island !== 'all' && s.location?.island !== filters.island) return false;
      if (filters.province !== 'all' && s.location?.province !== filters.province) return false;
      if (filters.district !== 'all' && s.location?.district !== filters.district) return false;
      if (filters.subdistrict !== 'all' && s.location?.subdistrict !== filters.subdistrict) return false;
      if (filters.surveyor !== 'all' && s.surveyor !== filters.surveyor) return false;
      if (filters.dateFrom && s.surveyDate < filters.dateFrom) return false;
      if (filters.dateTo && s.surveyDate > filters.dateTo) return false;
      return true;
    });
  }

  function filterBarHtml(showAll = true) {
    const years = refMeta.cropYears || [];
    const provinces = refMeta.provinces || [];
    const islands = refMeta.islands || [];
    const surveyors = refMeta.surveyors || [];
    // Cascading district/sub-district options derived from currently loaded surveys
    const districtsInProvince = filters.province !== 'all'
      ? Array.from(new Set(allSurveys.filter(s => s.location?.province === filters.province).map(s => s.location?.district).filter(Boolean))).sort()
      : [];
    const subdistrictsInDistrict = filters.district !== 'all'
      ? Array.from(new Set(allSurveys.filter(s => s.location?.district === filters.district).map(s => s.location?.subdistrict).filter(Boolean))).sort()
      : [];
    const opt = (val, cur) => `<option value="${val}" ${String(val) === String(cur) ? 'selected' : ''}>${val === 'all' ? 'All' : val}</option>`;
    return `<div class="filter-bar">
      <select id="f-cropYear">${['all', ...years].map(v => opt(v, filters.cropYear)).join('')}</select>
      <select id="f-coffeeType">${['all', 'Robusta', 'Arabica'].map(v => opt(v, filters.coffeeType)).join('')}</select>
      ${showAll ? `<select id="f-island">${['all', ...islands].map(v => opt(v, filters.island)).join('')}</select>` : ''}
      ${showAll ? `<select id="f-province">${['all', ...provinces].map(v => opt(v, filters.province)).join('')}</select>` : ''}
      ${showAll && filters.province !== 'all' ? `<select id="f-district">${['all', ...districtsInProvince].map(v => opt(v, filters.district)).join('')}</select>` : ''}
      ${showAll && filters.district !== 'all' ? `<select id="f-subdistrict">${['all', ...subdistrictsInDistrict].map(v => opt(v, filters.subdistrict)).join('')}</select>` : ''}
      ${showAll ? `<select id="f-surveyor">${['all', ...surveyors].map(v => opt(v, filters.surveyor)).join('')}</select>` : ''}
      <input type="date" id="f-dateFrom" value="${filters.dateFrom}" title="From date"/>
      <input type="date" id="f-dateTo" value="${filters.dateTo}" title="To date"/>
      <button id="f-clear" class="btn-chip">Clear</button>
    </div>`;
  }

  function bindFilterBar(onChange) {
    const ids = ['f-cropYear', 'f-coffeeType', 'f-island', 'f-province', 'f-district', 'f-subdistrict', 'f-surveyor', 'f-dateFrom', 'f-dateTo'];
    ids.forEach(id => {
      const elx = document.getElementById(id);
      if (!elx) return;
      elx.addEventListener('change', () => {
        const map = { 'f-cropYear': 'cropYear', 'f-coffeeType': 'coffeeType', 'f-island': 'island', 'f-province': 'province', 'f-district': 'district', 'f-subdistrict': 'subdistrict', 'f-surveyor': 'surveyor', 'f-dateFrom': 'dateFrom', 'f-dateTo': 'dateTo' };
        filters[map[id]] = elx.value;
        if (id === 'f-province') { filters.district = 'all'; filters.subdistrict = 'all'; }
        if (id === 'f-district') { filters.subdistrict = 'all'; }
        onChange();
      });
    });
    const clearBtn = document.getElementById('f-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      filters = { cropYear: 'all', coffeeType: 'all', island: 'all', province: 'all', district: 'all', subdistrict: 'all', surveyor: 'all', dateFrom: '', dateTo: '' };
      onChange();
    });
  }

  // ===================== HOME DASHBOARD =====================
  // NOTE: KPI aggregation (totals, avg outlook %, avg harvest %) is computed
  // server-side by POST /api/analytics/aggregate (see
  // backend/services/analytics_service.py::aggregate_surveys) -- this view
  // only renders whatever the API returns. Falls back to a local zeroed
  // aggregate if the central server isn't configured/reachable so the
  // offline-only deployment mode keeps working.
  function zeroAggregate() {
    return { totalFarms: 0, totalLocations: 0, totalHa: 0, provincesCompleted: 0,
      robustaCount: 0, arabicaCount: 0, robustaHa: 0, arabicaHa: 0,
      avgOutlookPct: null, avgOutlookLabel: 'Similar', avgHarvestPct: null };
  }

  async function computeAggregate(filtered) {
    if (!Api.isConfigured()) return zeroAggregate();
    try {
      return await Api.analyticsAggregate(filtered);
    } catch (e) {
      console.warn('analyticsAggregate failed, falling back to zeroed KPIs:', e);
      return zeroAggregate();
    }
  }

  async function viewHome() {
    await refreshData();
    const filtered = applyFilters(allSurveys);
    const agg = await computeAggregate(filtered);
    const pending = await Sync.getPendingCounts();
    const targetLocations = 350; // demo survey target
    const surveyProgressPct = Math.min(100, Math.round((agg.totalLocations / targetLocations) * 100));
    const todayStr = new Date().toISOString().slice(0, 10);
    const todaysSurveys = allSurveys.filter(s => (s.surveyDate || '').slice(0, 10) === todayStr);
    const todaysSurveyCount = todaysSurveys.length;
    const syncedTodayCount = todaysSurveys.filter(s => s.status === 'synced').length;

    rootEl().innerHTML = `
      ${filterBarHtml()}
      <div class="dash-grid">
        <div class="kpi-card"><div class="kpi-label">Crop Year</div><div class="kpi-value">${filters.cropYear === 'all' ? refMeta.currentCropYear : filters.cropYear}</div></div>
        <div class="kpi-card"><div class="kpi-label">Farms Visited</div><div class="kpi-value">${Utils.fmtNum(agg.totalFarms)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Survey Locations</div><div class="kpi-value">${Utils.fmtNum(agg.totalLocations)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Hectares Surveyed</div><div class="kpi-value">${Utils.fmtNum(agg.totalHa,1)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Provinces Covered</div><div class="kpi-value">${agg.provincesCompleted}</div></div>
        <div class="kpi-card"><div class="kpi-label">Avg Crop Outlook</div><div class="kpi-value" style="color:${Utils.outlookColor(agg.avgOutlookLabel)}">${Utils.fmtPct(agg.avgOutlookPct)}</div></div>
      </div>

      <div class="card">
        <div class="card-title">Robusta vs Arabica Coverage</div>
        <canvas id="chart-coverage" height="160"></canvas>
      </div>

      <div class="card">
        <div class="card-title">Harvest Progress</div>
        <canvas id="gauge-harvest" height="140"></canvas>
      </div>

      <div class="card">
        <div class="card-title">Survey Progress vs Target (${targetLocations} locations)</div>
        <div class="progress-bar big"><div class="progress-fill" style="width:${surveyProgressPct}%"></div></div>
        <div class="muted small">${agg.totalLocations} / ${targetLocations} locations (${surveyProgressPct}%)</div>
      </div>

      <div class="card">
        <div class="card-title">Map — Completed vs Pending Locations</div>
        <canvas id="home-map" height="320"></canvas>
        ${MapView.legendHtml()}
      </div>

      <div class="card">
        <div class="card-title">Today's Surveys &nbsp; <b>${todaysSurveyCount}</b></div>
        <div class="sync-status-row">
          <span class="badge badge-synced">Synced &nbsp;${syncedTodayCount}</span>
          <span class="badge badge-waiting">Waiting to Sync &nbsp;${pending.waiting_sync}</span>
          <span class="badge badge-draft">Draft &nbsp;${pending.draft}</span>
          <span class="badge badge-error">Sync Error &nbsp;${pending.sync_error}</span>
          <span class="badge badge-conflict">Conflicts &nbsp;${pending.conflict}</span>
        </div>
        <div class="muted small" style="margin-top:8px">
          ${Sync.isOnline() ? '🟢 Online' : '🔴 Offline'} ${Api.isConfigured() ? '· Central server configured' : '· Local-only mode (no server configured)'}
        </div>
        <button id="btn-sync-now" class="btn-primary" style="width:100%;margin-top:10px" ${(!Sync.isOnline() || (pending.waiting_sync + pending.sync_error) === 0) ? 'disabled' : ''}>
          ${Sync.isSyncing ? '⏳ Syncing...' : '🔄 SYNC NOW'}
        </button>
        <button id="btn-open-sync-center" class="btn-secondary" style="width:100%;margin-top:8px">🗂️ Offline Queue &amp; Sync Center</button>
      </div>

      <div class="card">
        <div class="card-title">Recent Field Submissions</div>
        <div id="recent-list"></div>
      </div>
    `;
    bindFilterBar(viewHome);

    const syncNowBtn = document.getElementById('btn-sync-now');
    if (syncNowBtn) syncNowBtn.addEventListener('click', async () => {
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = '⏳ Syncing...';
      const result = await Sync.syncAll({ trigger: 'manual' });
      toast(`Sync complete: ${result.synced} synced, ${result.failed} failed, ${result.conflicts || 0} conflicts.`, result.failed ? 'error' : 'info');
      viewHome();
    });
    const openSyncCenterBtn = document.getElementById('btn-open-sync-center');
    if (openSyncCenterBtn) openSyncCenterBtn.addEventListener('click', () => navigate('#/sync-center'));

    Charts.donutChart(document.getElementById('chart-coverage'), [
      { label: 'Robusta', value: agg.robustaCount, color: '#6f4e37' },
      { label: 'Arabica', value: agg.arabicaCount, color: '#2e7d32' },
    ], { centerText: `${agg.totalFarms}`, centerSubText: 'Surveys' });

    Charts.gauge(document.getElementById('gauge-harvest'), agg.avgHarvestPct || 0, { color: '#6f4e37' });

    const points = filtered.map(s => ({ lat: s.location?.lat, lon: s.location?.lon, coffeeType: s.coffeeType, status: s.status })).filter(p => p.lat && p.lon);
    MapView.render(document.getElementById('home-map'), points, (pt) => {
      toast(`${pt.coffeeType} · ${pt.status === 'synced' ? 'Completed' : 'Pending sync'}`);
    });

    const recent = [...filtered].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8);
    document.getElementById('recent-list').innerHTML = recent.length ? recent.map(s => `
      <div class="list-row" data-id="${s.id}">
        <div class="list-row-main">
          <b>${s.farmerId || s.id}</b> — ${s.farmerName || 'Unnamed'} · ${s.province || '—'}, ${s.district || ''}
          <div class="muted small">${s.surveyDate} · ${s.surveyor}</div>
        </div>
        <span class="status-chip status-${s.status}">${statusLabel(s.status)}</span>
      </div>`).join('') : '<p class="muted">No submissions yet.</p>';

    Utils.qsa('.list-row', document.getElementById('recent-list')).forEach(row => {
      row.addEventListener('click', () => navigate(`#/survey-detail/${row.getAttribute('data-id')}`));
    });
  }

  function statusLabel(status) {
    return { synced: 'Synced', waiting_sync: 'Waiting for Sync', draft: 'Draft', sync_error: 'Sync Error', syncing: 'Syncing...', conflict: 'Conflict' }[status] || status;
  }

  // ===================== SURVEY LIST =====================
  async function viewSurveyList() {
    await refreshData();
    const filtered = applyFilters(allSurveys).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    rootEl().innerHTML = `
      ${filterBarHtml()}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div><b>${filtered.length}</b> surveys</div>
        <button id="btn-new-survey" class="btn-primary">+ New Survey</button>
      </div>
      <div id="survey-list"></div>
    `;
    bindFilterBar(viewSurveyList);
    document.getElementById('btn-new-survey').addEventListener('click', () => navigate('#/new-survey'));
    document.getElementById('survey-list').innerHTML = filtered.map(s => `
      <div class="list-row" data-id="${s.id}">
        <div class="list-row-main">
          <b>${s.farmerId || s.id}</b> — ${s.farmerName || 'Unnamed'}
          <div class="muted small">${s.province || '—'} · ${s.surveyDate} · ${s.surveyor}</div>
        </div>
        <span class="status-chip status-${s.status}">${statusLabel(s.status)}</span>
      </div>`).join('') || '<p class="muted">No surveys match filters.</p>';

    Utils.qsa('.list-row', document.getElementById('survey-list')).forEach(row => {
      row.addEventListener('click', async () => {
        const id = row.getAttribute('data-id');
        const rec = allSurveys.find(s => s.id === id);
        if (rec && (rec.status === 'draft' || rec.status === 'sync_error')) {
          navigate(`#/edit-survey/${id}`);
        } else {
          navigate(`#/survey-detail/${id}`);
        }
      });
    });
  }

  async function viewSurveyDetail(id) {
    await refreshData();
    const s = allSurveys.find(x => x.id === id);
    if (!s) { rootEl().innerHTML = '<div class="card">Survey not found.</div>'; return; }
    rootEl().innerHTML = `
      <div class="card">
        <button class="btn-secondary" id="btn-back">◀ Back</button>
        <h3>${s.farmerId || s.id} — ${s.farmerName || ''}</h3>
        <span class="status-chip status-${s.status}">${statusLabel(s.status)}</span>
      </div>
      <div class="card">
        <div class="card-title">Location</div>
        <div class="kv">${kvRow('Province', s.province)}${kvRow('District', s.district)}${kvRow('Sample No.', s.sampleNo)}${kvRow('GPS', s.gps?.lat ? `${s.gps.lat}, ${s.gps.lon}` : '—')}</div>
      </div>
      <div class="card">
        <div class="card-title">Farmer</div>
        <div class="kv">${kvRow('Farmer ID', s.farmerId)}${kvRow('Name', s.farmerName)}${kvRow('Phone', s.farmerPhNo)}${kvRow('Note', s.farmerNote)}</div>
      </div>
      <div class="card">
        <div class="card-title">Coffee Area &amp; Production</div>
        <div class="kv">${kvRow('Total Coffee Area (Ha)', s.totalCoffeeAreaHa)}${kvRow('Bearing Area 2026-27 (Ha)', s.bearingArea2026_27)}${kvRow('Production 2026-27 (Quintals)', s.production2026_27)}${kvRow('Fly Crop vs LY', s.flyCropCompareToLY)}${kvRow('Main Crop vs LY', s.mainCropCompareToLY)}</div>
      </div>
      <div class="card">
        <div class="card-title">Photos</div>
        <div class="photo-grid">${(s.photos || []).map(p => `<div class="photo-card"><img src="${p.dataUrl}" class="photo-thumb"/><div class="photo-card-label">${p.category}</div></div>`).join('') || '<p class="muted">No photos.</p>'}</div>
      </div>
    `;
    document.getElementById('btn-back').addEventListener('click', () => navigate('#/surveys'));
  }

  function kvRow(k, v) { return `<div class="kv-row"><span class="kv-key">${k}</span><span class="kv-val">${v ?? '—'}</span></div>`; }

  // ===================== NEW / EDIT SURVEY =====================
  async function viewNewSurvey() {
    rootEl().innerHTML = `<div id="wizard-container"></div>`;
    await SurveyForm.start(document.getElementById('wizard-container'), null);
  }
  async function viewEditSurvey(id) {
    const draft = await DB.get('drafts', id);
    rootEl().innerHTML = `<div id="wizard-container"></div>`;
    await SurveyForm.start(document.getElementById('wizard-container'), draft);
  }

  // ===================== MAP PAGE =====================
  async function viewMap() {
    await refreshData();
    const filtered = applyFilters(allSurveys);
    rootEl().innerHTML = `
      ${filterBarHtml()}
      <div class="card">
        <canvas id="full-map" height="420"></canvas>
        ${MapView.legendHtml()}
      </div>
      <div class="card">
        <div class="card-title">Export GPS Data</div>
        <div class="export-btn-row">
          <button id="exp-csv" class="btn-secondary">Export CSV</button>
          <button id="exp-geojson" class="btn-secondary">Export GeoJSON</button>
          <button id="exp-kml" class="btn-secondary">Export KML</button>
        </div>
      </div>
      <div id="point-detail"></div>
    `;
    bindFilterBar(viewMap);
    const points = filtered.filter(s => s.location?.lat && s.location?.lon);
    MapView.render(document.getElementById('full-map'), points.map(s => ({ lat: s.location.lat, lon: s.location.lon, coffeeType: s.coffeeType, status: s.status, survey: s })),
      (pt) => {
        const s = pt.survey;
        document.getElementById('point-detail').innerHTML = `
          <div class="card">
            <div class="card-title">${s.farmerId || s.id} — ${s.farmerName || ''}</div>
            <div class="kv">
              ${kvRow('Location', `${s.district || ''}, ${s.province || ''}`)}
              ${kvRow('Farmer ID', s.farmerId)}
              ${kvRow('Total Coffee Area', (s.totalCoffeeAreaHa ?? '—') + ' ha')}
              ${kvRow('Production 2026-27', (s.production2026_27 ?? '—') + ' Quintals')}
              ${kvRow('Fly Crop vs LY', s.flyCropCompareToLY)}
              ${kvRow('Survey Date', s.surveyDate)}
            </div>
            ${(s.photos||[]).length ? `<div class="photo-grid">${s.photos.map(p=>`<img src="${p.dataUrl}" class="photo-thumb"/>`).join('')}</div>` : ''}
          </div>`;
      });

    document.getElementById('exp-csv').addEventListener('click', () => Utils.downloadBlob(Utils.toCSV(Utils.surveysToFlatRows(points)), 'crop_tour_surveys.csv', 'text/csv'));
    document.getElementById('exp-geojson').addEventListener('click', () => Utils.downloadBlob(JSON.stringify(Utils.toGeoJSON(points), null, 2), 'crop_tour_points.geojson', 'application/geo+json'));
    document.getElementById('exp-kml').addEventListener('click', () => Utils.downloadBlob(Utils.toKML(points), 'crop_tour_points.kml', 'application/vnd.google-earth.kml+xml'));
  }

  // ===================== COMPARISON DASHBOARD =====================
  // NOTE: all group-by statistics (production MT, area, implied yield,
  // harvest %, YoY change %) are computed server-side by
  // POST /api/analytics/compare (see
  // backend/services/analytics_service.py::compare_by_field / stats_for).
  // This view only groups locally for chart/table iteration order and
  // renders whatever the API returned.
  function zeroGroupStats() {
    return { productionMt: 0, areaHa: 0, yieldKgHa: 0, harvestPct: 0, changePct: null, changeLabel: 'Similar', coverage: 0 };
  }

  async function computeCompareGroups(filtered, groupByField) {
    if (!Api.isConfigured()) return {};
    try {
      const resp = await Api.analyticsCompare(filtered, groupByField);
      return resp.groups || {};
    } catch (e) {
      console.warn('analyticsCompare failed for', groupByField, e);
      return {};
    }
  }

  async function viewCompare() {
    await refreshData();
    const filtered = applyFilters(allSurveys);

    const [byTypeStats, byProvinceStats, byIslandStats] = await Promise.all([
      computeCompareGroups(filtered, 'coffeeType'),
      computeCompareGroups(filtered, 'location.province'),
      computeCompareGroups(filtered, 'location.island'),
    ]);

    const rTotal = byTypeStats['Robusta'] || zeroGroupStats();
    const aTotal = byTypeStats['Arabica'] || zeroGroupStats();

    rootEl().innerHTML = `
      ${filterBarHtml()}
      <div class="card">
        <div class="card-title">Robusta vs Arabica</div>
        <table class="cmp-table">
          <tr><th></th><th>Robusta</th><th>Arabica</th></tr>
          <tr><td>Production</td><td>${Utils.fmtNum(rTotal.productionMt,1)} MT</td><td>${Utils.fmtNum(aTotal.productionMt,1)} MT</td></tr>
          <tr><td>Area</td><td>${Utils.fmtNum(rTotal.areaHa,1)} ha</td><td>${Utils.fmtNum(aTotal.areaHa,1)} ha</td></tr>
          <tr><td>Yield</td><td>${Utils.fmtNum(rTotal.yieldKgHa,0)} kg/ha</td><td>${Utils.fmtNum(aTotal.yieldKgHa,0)} kg/ha</td></tr>
          <tr><td>Harvest Progress</td><td>${Utils.fmtNum(rTotal.harvestPct,0)}%</td><td>${Utils.fmtNum(aTotal.harvestPct,0)}%</td></tr>
          <tr><td>Crop Change</td><td style="color:${Utils.outlookColor(rTotal.changeLabel)}">${Utils.fmtPct(rTotal.changePct)}</td><td style="color:${Utils.outlookColor(aTotal.changeLabel)}">${Utils.fmtPct(aTotal.changePct)}</td></tr>
          <tr><td>Survey Coverage</td><td>${rTotal.coverage}</td><td>${aTotal.coverage}</td></tr>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Production by Province (Current vs Previous, MT)</div>
        <canvas id="chart-province-cmp" height="220"></canvas>
      </div>

      <div class="card">
        <div class="card-title">Crop Change % by Island</div>
        <canvas id="chart-island-cmp" height="200"></canvas>
      </div>

      <div class="card">
        <div class="card-title">Province Comparison Table</div>
        <div class="table-wrap">
        <table class="cmp-table">
          <tr><th>Province</th><th>Prod MT</th><th>Area ha</th><th>Yield kg/ha</th><th>Harvest %</th><th>Change %</th><th>Coverage</th></tr>
          ${Object.entries(byProvinceStats).sort((a,b)=>b[1].productionMt - a[1].productionMt).map(([prov, st]) => {
            return `<tr><td>${prov}</td><td>${Utils.fmtNum(st.productionMt,1)}</td><td>${Utils.fmtNum(st.areaHa,1)}</td><td>${Utils.fmtNum(st.yieldKgHa,0)}</td><td>${Utils.fmtNum(st.harvestPct,0)}</td><td style="color:${Utils.outlookColor(st.changeLabel)}">${Utils.fmtPct(st.changePct)}</td><td>${st.coverage}</td></tr>`;
          }).join('')}
        </table>
        </div>
      </div>
    `;
    bindFilterBar(viewCompare);

    const provNames = Object.keys(byProvinceStats);
    Charts.barChart(document.getElementById('chart-province-cmp'), provNames.map(p=>p.slice(0,6)),
      provNames.map(p => byProvinceStats[p].productionMt), { fmt: v => Utils.fmtNum(v,0), color: '#6f4e37' });

    const islandNames = Object.keys(byIslandStats);
    Charts.barChart(document.getElementById('chart-island-cmp'), islandNames.map(i=>i.slice(0,8)),
      islandNames.map(i => byIslandStats[i].changePct || 0), { fmt: v => Utils.fmtPct(v), perBarColor: (v, i) => Utils.outlookColor(islandNames[i] ? byIslandStats[islandNames[i]].changeLabel : 'Similar') });
  }

  // ===================== PRODUCTION FORECAST =====================
  // NOTE: village->...->Indonesia rollup math (scale factor, initial/final
  // estimate, diff %) is computed server-side by POST /api/analytics/forecast
  // (see backend/services/analytics_service.py::forecast_rows).
  async function computeForecast(filtered, adjustments) {
    if (!Api.isConfigured()) return { rows: [], totalFinalMt: 0, totalInitialMt: 0 };
    try {
      return await Api.analyticsForecast(filtered, refMeta.provinceRef || [], adjustments);
    } catch (e) {
      console.warn('analyticsForecast failed:', e);
      return { rows: [], totalFinalMt: 0, totalInitialMt: 0 };
    }
  }

  async function viewForecast() {
    await refreshData();
    const filtered = applyFilters(allSurveys);
    const adjustments = await DB.getAll('adjustments');

    const { rows, totalFinalMt: totalFinal, totalInitialMt: totalInitial } = await computeForecast(filtered, adjustments);

    rootEl().innerHTML = `
      ${filterBarHtml()}
      <div class="dash-grid">
        <div class="kpi-card"><div class="kpi-label">Indonesia Final Estimate</div><div class="kpi-value">${Utils.fmtNum(totalFinal,0)} MT</div></div>
        <div class="kpi-card"><div class="kpi-label">Indonesia Initial Estimate</div><div class="kpi-value">${Utils.fmtNum(totalInitial,0)} MT</div></div>
        <div class="kpi-card"><div class="kpi-label">Net Difference</div><div class="kpi-value" style="color:${totalFinal>=totalInitial?'#1a7f37':'#d32f2f'}">${Utils.fmtNum(totalFinal-totalInitial,0)} MT</div></div>
      </div>
      <div class="card">
        <div class="card-title">Aggregation: Village → Sub-district → District → Province → Island → Indonesia</div>
        <div class="table-wrap">
        <table class="cmp-table">
          <tr><th>Province</th><th>Initial Est. MT</th><th>Survey-based MT</th><th>Mgmt Adj %</th><th>Final Est. MT</th><th>Diff MT</th><th>Diff %</th><th>Adjust</th></tr>
          ${rows.map(r => `<tr>
            <td>${r.province}</td>
            <td>${Utils.fmtNum(r.initialEstMt,0)}</td>
            <td>${Utils.fmtNum(r.surveyEstMt,0)}</td>
            <td>${Utils.fmtNum(r.adjPct,1)}%</td>
            <td><b>${Utils.fmtNum(r.finalEstMt,0)}</b></td>
            <td style="color:${r.diffMt>=0?'#1a7f37':'#d32f2f'}">${Utils.fmtNum(r.diffMt,0)}</td>
            <td style="color:${r.diffMt>=0?'#1a7f37':'#d32f2f'}">${Utils.fmtPct(r.diffPct)}</td>
            <td>${Auth.can('adjustEstimate') ? `<button class="btn-chip btn-adjust" data-prov="${r.province}">Adjust</button>` : '—'}</td>
          </tr>`).join('')}
        </table>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Revision History</div>
        <div id="revision-history"></div>
      </div>
    `;
    bindFilterBar(viewForecast);

    Utils.qsa('.btn-adjust').forEach(btn => btn.addEventListener('click', async () => {
      const prov = btn.getAttribute('data-prov');
      const pctStr = prompt(`Enter management adjustment % for ${prov} (e.g. 5 for +5%, -10 for -10%):`, '0');
      if (pctStr === null) return;
      const pct = parseFloat(pctStr);
      if (Number.isNaN(pct)) { toast('Invalid number', 'error'); return; }
      const user = Auth.currentUser();
      const rec = { id: Utils.uid('ADJ'), province: prov, adjustmentPct: pct, ts: Utils.nowIso(), user: user?.name, role: user?.role };
      await DB.put('adjustments', rec);
      await DB.logAudit(user, 'ADJUST_ESTIMATE', 'province', prov, `Applied ${pct}% adjustment`);
      toast(`Adjustment saved for ${prov}`);
      viewForecast();
    }));

    const history = adjustments.sort((a,b)=>b.ts.localeCompare(a.ts)).slice(0, 20);
    document.getElementById('revision-history').innerHTML = history.length ? history.map(h => `
      <div class="list-row">
        <div class="list-row-main"><b>${h.province}</b>: ${h.adjustmentPct}% <div class="muted small">${new Date(h.ts).toLocaleString()} by ${h.user} (${h.role})</div></div>
      </div>`).join('') : '<p class="muted">No revisions yet.</p>';
  }

  // ===================== MANAGEMENT DASHBOARD =====================
  const MAJOR_PROVINCES = ['Lampung','South Sumatra','Bengkulu','Jambi','Aceh','North Sumatra','East Java','Central Java','West Java','Bali','West Nusa Tenggara','East Nusa Tenggara','South Sulawesi'];

  // NOTE: management-dashboard aggregate stats (totals, YoY %, condition
  // avg) and major-producing-region rows are computed server-side by
  // POST /api/analytics/dashboard-stats (see
  // backend/services/analytics_service.py::dashboard_stats /
  // major_regions_stats).
  async function computeDashboardStats(filtered) {
    if (!Api.isConfigured()) {
      return {
        stats: { totalMt: 0, robustaMt: 0, arabicaMt: 0, yoyPct: null, yoyLabel: 'Similar', harvestPct: 0, conditionAvg: 0, secondCropMt: 0 },
        major_regions: MAJOR_PROVINCES.map(p => ({ province: p, mt: 0, changePct: null, changeLabel: 'Similar', coverage: 0 })),
      };
    }
    try {
      return await Api.analyticsDashboardStats(filtered, MAJOR_PROVINCES);
    } catch (e) {
      console.warn('analyticsDashboardStats failed:', e);
      return {
        stats: { totalMt: 0, robustaMt: 0, arabicaMt: 0, yoyPct: null, yoyLabel: 'Similar', harvestPct: 0, conditionAvg: 0, secondCropMt: 0 },
        major_regions: MAJOR_PROVINCES.map(p => ({ province: p, mt: 0, changePct: null, changeLabel: 'Similar', coverage: 0 })),
      };
    }
  }

  async function viewManagement() {
    await refreshData();
    const filtered = applyFilters(allSurveys);
    const { stats, major_regions: majorRows } = await computeDashboardStats(filtered);
    const { totalMt, robustaMt, arabicaMt, yoyPct, yoyLabel, harvestPct, conditionAvg, secondCropMt } = stats;

    rootEl().innerHTML = `
      ${filterBarHtml()}
      <div class="dash-grid">
        <div class="kpi-card"><div class="kpi-label">Indonesia Crop Estimate</div><div class="kpi-value">${Utils.fmtNum(totalMt,0)} MT</div></div>
        <div class="kpi-card"><div class="kpi-label">Robusta Estimate</div><div class="kpi-value">${Utils.fmtNum(robustaMt,0)} MT</div></div>
        <div class="kpi-card"><div class="kpi-label">Arabica Estimate</div><div class="kpi-value">${Utils.fmtNum(arabicaMt,0)} MT</div></div>
        <div class="kpi-card"><div class="kpi-label">Crop Change YoY</div><div class="kpi-value" style="color:${Utils.outlookColor(yoyLabel)}">${Utils.fmtPct(yoyPct)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Harvest Progress</div><div class="kpi-value">${Utils.fmtNum(harvestPct,0)}%</div></div>
        <div class="kpi-card"><div class="kpi-label">2nd Crop Potential</div><div class="kpi-value">${Utils.fmtNum(secondCropMt,0)} MT</div></div>
      </div>

      <div class="card">
        <div class="card-title">Production by Province</div>
        <canvas id="mgmt-province-chart" height="220"></canvas>
      </div>

      <div class="card">
        <div class="card-title">Major Producing Regions</div>
        <div class="table-wrap">
        <table class="cmp-table">
          <tr><th>Region</th><th>Production MT</th><th>YoY Change</th><th>Coverage</th></tr>
          ${majorRows.map(r => `<tr><td>${r.province}</td><td>${Utils.fmtNum(r.mt,0)}</td><td style="color:${Utils.outlookColor(r.changeLabel)}">${Utils.fmtPct(r.changePct)}</td><td>${r.coverage}</td></tr>`).join('')}
        </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Crop Condition & Readiness</div>
        <canvas id="mgmt-gauge-condition" height="140"></canvas>
        <div class="muted small" style="text-align:center">Average Overall Crop Condition (1-5 scale, shown as %)</div>
      </div>

      <div class="card">
        <div class="card-title">Map — National Crop Outlook</div>
        <canvas id="mgmt-map" height="320"></canvas>
        ${MapView.legendHtml()}
      </div>
    `;
    bindFilterBar(viewManagement);

    Charts.barChart(document.getElementById('mgmt-province-chart'), majorRows.map(r=>r.province.slice(0,6)), majorRows.map(r=>r.mt), { fmt: v=>Utils.fmtNum(v,0), color: '#6f4e37' });
    Charts.gauge(document.getElementById('mgmt-gauge-condition'), (conditionAvg/5)*100, { color: '#4caf50' });
    const points = filtered.filter(s=>s.location?.lat && s.location?.lon).map(s=>({lat:s.location.lat, lon:s.location.lon, coffeeType:s.coffeeType, status:s.status}));
    MapView.render(document.getElementById('mgmt-map'), points, (pt)=> toast(`${pt.coffeeType} · ${pt.status}`));
  }

  // ===================== CROP TOUR REPORT =====================
  // NOTE: the narrative paragraph (production estimate, harvest %, outlook
  // wording, peak-harvest mention, fruit-load description) is generated
  // server-side by POST /api/analytics/narrative (see
  // backend/services/analytics_service.py::narrative_for) so every client
  // renders identical report text from identical calculations.
  async function narrativeFor(scopeName, list) {
    if (!Api.isConfigured()) {
      return list.length ? `Report narrative unavailable (no central server configured) for ${scopeName}.`
                          : `No survey data available for ${scopeName} yet.`;
    }
    try {
      const resp = await Api.analyticsNarrative(scopeName, list);
      return resp.narrative;
    } catch (e) {
      console.warn('analyticsNarrative failed for', scopeName, e);
      return `Report narrative unavailable for ${scopeName} (server error).`;
    }
  }

  async function viewReport() {
    await refreshData();
    const filtered = applyFilters(allSurveys);
    const byProvince = Utils.groupBy(filtered, s => s.location?.province || 'Unknown');
    const byIsland = Utils.groupBy(filtered, s => s.location?.island || 'Unknown');
    const robusta = filtered.filter(s=>s.coffeeType==='Robusta');
    const arabica = filtered.filter(s=>s.coffeeType==='Arabica');

    const [nationalNarrative, robustaNarrative, arabicaNarrative, islandNarratives, provinceNarratives] = await Promise.all([
      narrativeFor('Indonesia', filtered),
      narrativeFor('Robusta-growing regions', robusta),
      narrativeFor('Arabica-growing regions', arabica),
      Promise.all(Object.entries(byIsland).map(async ([isl, list]) => [isl, await narrativeFor(isl, list)])),
      Promise.all(Object.entries(byProvince).map(async ([prov, list]) => [prov, list.length, await narrativeFor(prov, list)])),
    ]);

    rootEl().innerHTML = `
      ${filterBarHtml()}
      <div class="card">
        <div class="card-title">Indonesia — National Summary</div>
        <p>${nationalNarrative}</p>
      </div>
      <div class="card">
        <div class="card-title">Robusta Outlook</div>
        <p>${robustaNarrative}</p>
      </div>
      <div class="card">
        <div class="card-title">Arabica Outlook</div>
        <p>${arabicaNarrative}</p>
      </div>
      <div class="card">
        <div class="card-title">By Island</div>
        ${islandNarratives.map(([isl, text]) => `<p><b>${isl}:</b> ${text}</p>`).join('')}
      </div>
      <div class="card">
        <div class="card-title">By Province</div>
        ${provinceNarratives.map(([prov, count, text]) => `<details><summary><b>${prov}</b> (${count} surveys)</summary><p>${text}</p></details>`).join('')}
      </div>
      <div class="card">
        <button id="btn-export-report-pdf" class="btn-primary" style="width:100%">📄 Export Report (Print/PDF)</button>
      </div>
    `;
    bindFilterBar(viewReport);
    document.getElementById('btn-export-report-pdf').addEventListener('click', () => window.print());
  }



  // ===================== DATA EXPORT =====================
  async function viewExport() {
    await refreshData();
    const filtered = applyFilters(allSurveys);
    rootEl().innerHTML = `
      ${filterBarHtml()}
      <div class="card">
        <div class="card-title">Export Filtered Data (${filtered.length} surveys)</div>
        <div class="export-btn-row" style="flex-direction:column">
          <button id="exp-excel-csv" class="btn-secondary">📊 Export Raw Data (CSV for Excel)</button>
          <button id="exp-summary-csv" class="btn-secondary">📈 Export Crop Estimate Summary (CSV)</button>
          <button id="exp-geojson2" class="btn-secondary">🗺️ Export GeoJSON</button>
          <button id="exp-kml2" class="btn-secondary">🗺️ Export KML</button>
          <button id="exp-pdf" class="btn-secondary">📄 Export Crop-Tour Report (PDF/Print)</button>
        </div>
      </div>
    `;
    bindFilterBar(viewExport);
    document.getElementById('exp-excel-csv').addEventListener('click', () => Utils.downloadBlob(Utils.toCSV(Utils.surveysToFlatRows(filtered)), 'crop_tour_raw_data.csv', 'text/csv'));
    // NOTE: per-province summary stats (production MT, change %, area,
    // avg harvest %) are computed server-side by POST /api/analytics/compare
    // (see backend/services/analytics_service.py::compare_by_field).
    document.getElementById('exp-summary-csv').addEventListener('click', async () => {
      const groups = await computeCompareGroups(filtered, 'location.province');
      const rows = Object.entries(groups).map(([prov, st]) => ({
        Province: prov, Surveys: st.coverage,
        ProductionMT: Math.round(st.productionMt*10)/10,
        ChangePct: Math.round((st.changePct||0)*10)/10,
        AreaHa: Math.round(st.areaHa*10)/10,
        AvgHarvestPct: Math.round(st.harvestPct||0),
      }));
      Utils.downloadBlob(Utils.toCSV(rows), 'crop_tour_summary.csv', 'text/csv');
    });

    document.getElementById('exp-geojson2').addEventListener('click', () => Utils.downloadBlob(JSON.stringify(Utils.toGeoJSON(filtered), null, 2), 'crop_tour.geojson', 'application/geo+json'));
    document.getElementById('exp-kml2').addEventListener('click', () => Utils.downloadBlob(Utils.toKML(filtered), 'crop_tour.kml', 'application/vnd.google-earth.kml+xml'));
    document.getElementById('exp-pdf').addEventListener('click', () => window.print());
  }

  // ===================== ADMIN =====================
  async function viewAdmin() {
    if (!Auth.can('manageUsers')) { rootEl().innerHTML = '<div class="card">Access restricted to Administrators.</div>'; return; }
    const users = await DB.getAll('users');
    const cropYears = await DB.getMeta('cropYears', []);
    const auditLog = (await DB.getAll('auditLog')).sort((a,b)=>b.ts.localeCompare(a.ts)).slice(0,30);
    rootEl().innerHTML = `
      <div class="card">
        <div class="card-title">Users</div>
        <div class="table-wrap"><table class="cmp-table">
          <tr><th>Username</th><th>Name</th><th>Role</th></tr>
          ${users.map(u=>`<tr><td>${u.username}</td><td>${u.name}</td><td>${u.role}</td></tr>`).join('')}
        </table></div>
        <button id="btn-add-user" class="btn-secondary" style="margin-top:8px">+ Add User</button>
      </div>
      <div class="card">
        <div class="card-title">Crop Years / Master Data</div>
        <div>Crop Years: ${cropYears.join(', ')}</div>
        <button id="btn-add-year" class="btn-secondary" style="margin-top:8px">+ Add Crop Year</button>
      </div>
      <div class="card">
        <div class="card-title">Audit Trail (latest 30)</div>
        ${auditLog.map(a=>`<div class="list-row"><div class="list-row-main"><b>${a.action}</b> ${a.entity}/${a.entityId}<div class="muted small">${new Date(a.ts).toLocaleString()} · ${a.user}</div></div></div>`).join('') || '<p class="muted">No audit entries.</p>'}
      </div>
    `;
    document.getElementById('btn-add-user').addEventListener('click', async () => {
      const username = prompt('Username:'); if (!username) return;
      const name = prompt('Full name:') || username;
      const role = prompt('Role (Field Surveyor / Agronomist / Manager / Administrator):', 'Field Surveyor') || 'Field Surveyor';
      await DB.put('users', { username, name, role, password: 'demo' });
      const user = Auth.currentUser();
      await DB.logAudit(user, 'CREATE_USER', 'user', username, `role=${role}`);
      toast('User added.');
      viewAdmin();
    });
    document.getElementById('btn-add-year').addEventListener('click', async () => {
      const y = parseInt(prompt('New crop year:', String(new Date().getFullYear()+1)));
      if (!y) return;
      const years = await DB.getMeta('cropYears', []);
      if (!years.includes(y)) { years.push(y); await DB.setMeta('cropYears', years.sort()); }
      const user = Auth.currentUser();
      await DB.logAudit(user, 'ADD_CROP_YEAR', 'meta', String(y));
      toast('Crop year added.');
      viewAdmin();
    });
  }

  // ===================== NAV / ROUTER =====================
  const ROUTES = [
    { path: '#/home', label: 'Home', icon: '🏠', view: viewHome },
    { path: '#/surveys', label: 'Surveys', icon: '📋', view: viewSurveyList },
    { path: '#/new-survey', label: 'New', icon: '➕', view: viewNewSurvey, roleNeeded: 'createSurvey' },
    { path: '#/map', label: 'Map', icon: '🗺️', view: viewMap },
    { path: '#/compare', label: 'Compare', icon: '📊', view: viewCompare },
    { path: '#/forecast', label: 'Forecast', icon: '📈', view: viewForecast },
    { path: '#/management', label: 'Management', icon: '🧭', view: viewManagement },
    { path: '#/report', label: 'Report', icon: '📝', view: viewReport },
    { path: '#/export', label: 'Export', icon: '⬇️', view: viewExport },
    { path: '#/sync-center', label: 'Sync Center', icon: '🗂️', view: () => SyncCenter.render(rootEl(), { toast, navigate }) },
    { path: '#/admin', label: 'Admin', icon: '⚙️', view: viewAdmin, roleNeeded: 'manageUsers' },
  ];


  function bottomNavHtml() {
    const primary = ['#/home', '#/surveys', '#/new-survey', '#/map', '#/more'];
    return `<nav class="bottom-nav">
      ${ROUTES.filter(r => primary.includes(r.path)).map(r => `<button class="nav-btn" data-path="${r.path}"><span class="nav-icon">${r.icon}</span><span class="nav-label">${r.label}</span></button>`).join('')}
      <button class="nav-btn" data-path="#/more"><span class="nav-icon">☰</span><span class="nav-label">More</span></button>
    </nav>`;
  }

  function moreMenuHtml() {
    const secondary = ROUTES.filter(r => !['#/home','#/surveys','#/new-survey','#/map'].includes(r.path));
    const user = Auth.currentUser();
    return `<div class="card">
        <div class="card-title">Signed in as</div>
        <div class="kv-row"><span class="kv-key">Name</span><span class="kv-val">${user ? user.name : '—'}</span></div>
        <div class="kv-row"><span class="kv-key">Role</span><span class="kv-val">${user ? user.role : '—'}</span></div>
      </div>
      <div class="card"><div class="card-title">More</div>
      ${secondary.map(r => `<button class="list-row list-row-btn" data-path="${r.path}"><span class="nav-icon">${r.icon}</span> ${r.label}</button>`).join('')}
      <button class="list-row list-row-btn" id="btn-switch-user"><span class="nav-icon">🔄</span> Switch User</button>
      <button class="list-row list-row-btn" id="btn-logout"><span class="nav-icon">🚪</span> Logout</button>
    </div>
    ${Auth.can('manageUsers') ? `
    <div class="card">
      <div class="card-title">Central Server (Administrator)</div>
      <div class="muted small" style="margin-bottom:8px">
        ${Api.isConfigured() ? `Connected to: <b>${LocalStore.getItem('cct_api_base_url')}</b>` : 'No central server configured -- app is running in local-only mode.'}
      </div>
      <button class="btn-secondary" id="btn-configure-server" style="width:100%">⚙️ Configure Server URL</button>
    </div>` : ''}`;
  }

  function updateHeader() {
    const user = Auth.currentUser();
    const hdr = document.getElementById('app-header-user');
    if (hdr && user) hdr.textContent = `${user.name} · ${user.role}`;
    const onlineBadge = document.getElementById('online-badge');
    if (onlineBadge) {
      onlineBadge.textContent = Sync.isOnline() ? '🟢 Online' : '🔴 Offline';
      onlineBadge.className = 'online-badge ' + (Sync.isOnline() ? 'online' : 'offline');
    }
  }

  async function navigate(path) {
    if (!Auth.isAuthenticated()) { renderLogin(); return; }
    window.location.hash = path;
    updateHeader();
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-path') === path));

    if (path === '#/more') {
      rootEl().innerHTML = moreMenuHtml();
      Utils.qsa('.list-row-btn[data-path]').forEach(btn => btn.addEventListener('click', () => navigate(btn.getAttribute('data-path'))));
      const logoutBtn = document.getElementById('btn-logout');
      if (logoutBtn) logoutBtn.addEventListener('click', () => { Auth.logout(); renderLogin(); });
      const switchUserBtn = document.getElementById('btn-switch-user');
      if (switchUserBtn) switchUserBtn.addEventListener('click', () => { Auth.logout(); renderLogin(true); });
      const configureServerBtn = document.getElementById('btn-configure-server');
      if (configureServerBtn) configureServerBtn.addEventListener('click', async () => {
        const current = LocalStore.getItem('cct_api_base_url') || '';
        const url = prompt('Enter the FastAPI backend URL (e.g. https://api.yourcompany.com), or leave blank to disable and use local-only mode:', current);
        if (url === null) return;
        Api.setBaseUrl(url.trim().replace(/\/$/, ''));
        if (Api.isConfigured()) {
          try {
            await Api.healthCheck();
            toast('Connected to central server successfully.');
          } catch (e) {
            toast('Could not reach that server: ' + e.message, 'error');
          }
        } else {
          toast('Central server disabled. App is now local-only.');
        }
        navigate('#/more');
      });
      return;
    }

    const detailMatch = path.match(/^#\/(survey-detail|edit-survey)\/(.+)$/);
    if (detailMatch) {
      if (detailMatch[1] === 'survey-detail') return viewSurveyDetail(detailMatch[2]);
      if (detailMatch[1] === 'edit-survey') return viewEditSurvey(detailMatch[2]);
    }

    const route = ROUTES.find(r => r.path === path);
    if (!route) return navigate('#/home');
    if (route.roleNeeded && !Auth.can(route.roleNeeded)) {
      rootEl().innerHTML = `<div class="card">Your role (${Auth.currentUser().role}) does not have access to this section.</div>`;
      return;
    }
    route.view();
  }

  function renderLogin(isSwitch) {
    document.getElementById('app-shell').innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <div class="login-logo">☕</div>
          <h2>${isSwitch ? 'Switch User' : 'Coffee Crop Tour'}</h2>
          <p class="muted">${isSwitch ? 'Sign in with a different account' : 'Field survey & crop intelligence platform'}</p>
          <div class="field" style="text-align:left;margin-top:12px">
            <label>Quick select account</label>
            <select id="login-quickselect">
              <option value="">Choose a demo account...</option>
              <option value="surveyor1">surveyor1 — Field Surveyor</option>
              <option value="agronomist1">agronomist1 — Agronomist</option>
              <option value="manager1">manager1 — Manager</option>
              <option value="admin1">admin1 — Administrator</option>
            </select>
          </div>
          <input type="text" id="login-username" placeholder="Username" value="surveyor1" style="margin-top:10px"/>
          <input type="password" id="login-password" placeholder="Password" value="demo"/>
          <button id="btn-login" class="btn-primary" style="width:100%">Log In</button>
          <p class="muted small" style="margin-top:10px">Demo accounts: surveyor1 / agronomist1 / manager1 / admin1 (password: demo)</p>
          <div id="login-error" class="error-text"></div>
        </div>
      </div>`;
    document.getElementById('btn-login').addEventListener('click', doLogin);
    document.getElementById('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('login-quickselect').addEventListener('change', (e) => {
      if (e.target.value) {
        document.getElementById('login-username').value = e.target.value;
        document.getElementById('login-password').value = 'demo';
      }
    });
  }

  async function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      await Auth.login(username, password);
      renderShell();
      navigate('#/home');
    } catch (e) {
      document.getElementById('login-error').textContent = e.message;
    }
  }

  function renderShell() {
    const user = Auth.currentUser();
    document.getElementById('app-shell').innerHTML = `
      <header class="app-header">
        <div class="app-header-title">☕ Coffee Crop Tour</div>
        <div class="app-header-right">
          <span id="online-badge" class="online-badge"></span>
          <span id="app-header-user" class="app-header-user">${user.name} · ${user.role}</span>
        </div>
      </header>
      <main id="app-root" class="app-root"></main>
      ${bottomNavHtml()}
      <div id="toast-container" class="toast-container"></div>
    `;
    Utils.qsa('.nav-btn').forEach(btn => btn.addEventListener('click', () => navigate(btn.getAttribute('data-path'))));
    updateHeader();
  }

  async function init() {
    await DB.open();
    await LocalStore.init(); // Step "Replace Local Storage" -- hydrate + one-time legacy migration
    await DB.ensureSeeded();
    Sync.init();
    Sync.onChange(() => updateHeader());
    window.addEventListener('online', updateHeader);
    window.addEventListener('offline', updateHeader);

    if (Auth.isAuthenticated()) {
      renderShell();
      const startPath = window.location.hash && window.location.hash !== '#/' ? window.location.hash : '#/home';
      navigate(startPath);
    } else {
      renderLogin();
    }
  }

  return { init, navigate, toast, filters };
})();

document.addEventListener('DOMContentLoaded', App.init);
