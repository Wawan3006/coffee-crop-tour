// ============================================================================
// survey-form.js — Multi-step "New Crop Survey" wizard.
// Rebuilt to match the official Crop Tour Questionnaire (QN.xlsx) column
// structure exactly. Steps:
//   Sample & Location -> Farmer -> Coffee Area -> Additional Bearing ->
//   Bearing & Production -> Selling 2026-27 -> Stock & Fly Crop Outlook ->
//   Fly Crop Volumes -> Main Crop Outlook -> Weather & Crop Development ->
//   Price & Market -> Labor & Inputs -> Photos -> Review -> Submit
// Autosaves to IndexedDB 'drafts' store on every step change ("Save Draft").
// ============================================================================

const SurveyForm = (() => {
  let state = null; // the in-progress survey object
  let stepIndex = 0;
  let container = null;
  let refData = { provinces: [], islands: [], surveyors: [] };

  const STEPS = [
    'Sample & Location', 'Farmer', 'Coffee Area', 'Additional Bearing',
    'Bearing & Production', 'Selling 2026-27', 'Stock & Fly Crop Outlook',
    'Fly Crop Volumes', 'Main Crop Outlook', 'Weather & Crop Development',
    'Price & Market', 'Labor & Inputs', 'Photos', 'Review',
  ];

  // ---- Option lists taken directly from QN.xlsx column headers/legends ----
  const FLY_CROP_COMPARE = ['Higher', 'Same', 'Lower'];
  const MAIN_CROP_COMPARE = ['Early', 'Same', 'Late'];
  const MAIN_CROP_REASON = ['Rains', 'Flowering', 'Dryness'];
  const START_MONTH_OPTIONS = ['3 - March', '4 - April', '5 - May'];
  const PEAK_HARVEST_MONTH_OPTIONS = ['5 - May', '6 - June', '7 - July', '8 - August'];
  const RAINFALL_OPTIONS = ['BN - Below Normal', 'N - Normal', 'AN - Above Normal', 'Ex - Excessive'];
  const CROP_DEV_OPTIONS = ['BN - Below Normal', 'N - Normal', 'AN - Above Normal'];
  const DAMAGE_OPTIONS = [
    '1 - Blossom', '2 - Fruit set', '3 - Blossom and Fruit set', '4 - Cherry development',
    '5 - Fruit set and Cherry development', '6 - Blossom and Cherry development',
    '7 - All 3 stages', '8 - No damage',
  ];
  const OPINION_PRICE_OPTIONS = ['Happy', 'Not Happy'];
  const FUTURE_PRICE_OPTIONS = ['B - Bullish', 'N - Neutral', 'S - Bearish'];
  const REACTION_OPTIONS = [
    '1 - Increase grafting', '2 - Increase fertilizer', '3 - Better husbandry (other than fertilizer)',
    '4 - Expanding area', '5 - Improve drying yard', '6 - Renovate house',
    '7 - Buying car/motorcycle', '8 - No change',
  ];
  const HERBICIDE_TYPE_OPTIONS = ['1 - Glifosat', '2 - Paraquat', '3 - 2,4-D', '4 - Combine', '5 - Others'];
  const PHOTO_CATEGORIES = ['Farm / Coffee Area', 'Trees / Cherries', 'Farmer Reference', 'Other'];

  function blankSurvey() {
    const user = Auth.currentUser();
    return {
      id: Utils.uid('DRAFT'),
      status: 'draft',
      createdAt: Utils.nowIso(),
      updatedAt: Utils.nowIso(),
      surveyor: user ? user.name : '',
      surveyDate: new Date().toISOString().slice(0, 10),
      cropYear: '2026-27',
      coffeeType: 'Robusta',
      sampleNo: '',
      location: { lat: null, lon: null, altitude: null, province: '', district: '' },
      farmer: { name: '', phone: '', note: '', updatedName: '', updatedPhone: '' },
      coffeeArea: { totalHaMar2025: null, totalHaCurrent: null, additionalExpandingTreesPerHa: null },
      additionalBearing: { y2025Ha: null, y2025Trees: null, y2026Ha: null, y2026Trees: null },
      bearingArea: { y2024_25: null, y2025_26: null, y2026_27: null, y2027_28: null },
      production: { y2024_25: null, y2025_26: null, y2026_27: null, y2027_28: null },
      selling2026_27: {
        nov25: null, dec25: null, jan26: null, feb26: null, mar26: null, apr26: null,
        may26: null, jun26: null, jul26: null, aug26: null, sep26: null, oct26: null,
        nov26: null, dec26: null, undecided: null,
      },
      stock: { actual2026_27Quintal: null, regionPct: null },
      flyCrop: {
        compareToLY: '',
        harvesting: { nov26: null, dec26: null, jan27: null, feb27: null },
        selling: { nov26: null, dec26: null, jan27: null, feb27: null },
      },
      mainCrop: { compareToLY: '', reason: '', startMonth: '', peakHarvestMonth: '' },
      weatherDev: {
        rainfallBlossom: '', rainfallFruitSet: '', devBlossom: '', devFruitSet: '',
        damage: '', rainsAtOpeningBlossom: false,
      },
      priceMarket: {
        avgPriceSold2025_26: null, existingPrice: null, expectedPrice: null,
        opinionCurrentPrice: '', futurePrice: '', reactionToHigherPrice: '',
      },
      laborInputs: {
        wage2025: null, wage2026: null, herbicideType: '', herbicideLitersPerYear: null,
        fertilizer: { npk2025: null, npk2026: null, urea2025: null, urea2026: null, tsp2025: null, tsp2026: null },
      },
      photos: [],
    };
  }

  async function loadRefData() {
    refData.provinces = await DB.getMeta('provinces', []);
    refData.islands = await DB.getMeta('islands', []);
    refData.surveyors = await DB.getMeta('surveyors', []);
  }

  async function start(rootEl, existingDraft = null) {
    container = rootEl;
    await loadRefData();
    state = existingDraft ? JSON.parse(JSON.stringify(existingDraft)) : blankSurvey();
    stepIndex = 0;
    render();
  }

  function selectField(name, value, label, options) {
    return `<div class="field">
      <label>${label}</label>
      <select data-field="${name}">
        <option value="">Select...</option>
        ${options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>`;
  }

  function textField(name, value, label, type = 'text', extra = '') {
    return `<div class="field">
      <label>${label}</label>
      <input type="${type}" data-field="${name}" value="${value ?? ''}" ${extra}/>
    </div>`;
  }

  function toggleField(name, value, label) {
    return `<div class="field toggle-field">
      <label>${label}</label>
      <button type="button" class="toggle-btn ${value ? 'on' : ''}" data-field="${name}" data-toggle="1">${value ? 'Yes' : 'No'}</button>
    </div>`;
  }

  function getNested(obj, path) {
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
  }
  function setNested(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  }

  // ===================== STEP 1: Sample & Location =====================
  function stepSampleLocation() {
    const l = state.location;
    return `
      <div class="step-body">
        ${textField('surveyDate', state.surveyDate, 'Survey Date', 'date')}
        ${selectField('surveyor', state.surveyor, 'Surveyor Name', refData.surveyors)}
        ${textField('cropYear', state.cropYear, 'Crop Year (e.g. 2026-27)')}
        ${textField('sampleNo', state.sampleNo, 'Sample No.')}
        <div class="field">
          <label>Coffee Type</label>
          <div class="toggle-group">
            <button type="button" class="chip ${state.coffeeType==='Robusta'?'active':''}" data-field="coffeeType" data-value="Robusta">Robusta</button>
            <button type="button" class="chip ${state.coffeeType==='Arabica'?'active':''}" data-field="coffeeType" data-value="Arabica">Arabica</button>
          </div>
        </div>
        <div class="field">
          <label>GPS Coordinates</label>
          <div class="gps-row">
            <input type="text" readonly value="${l.lat && l.lon ? `${l.lat}, ${l.lon} (±${l.accuracyM || '?'}m)` : 'Not captured yet'}"/>
            <button type="button" id="btn-capture-gps" class="btn-secondary">📍 Capture GPS</button>
          </div>
        </div>
        ${selectField('location.province', l.province, 'Province', refData.provinces)}
        ${textField('location.district', l.district, 'District')}
        ${textField('location.altitude', l.altitude, 'Altitude (m)', 'number')}
      </div>`;
  }

  // ===================== STEP 2: Farmer =====================
  function stepFarmer() {
    const f = state.farmer;
    return `<div class="step-body">
      ${textField('farmer.name', f.name, 'Farmer Name')}
      ${textField('farmer.phone', f.phone, 'Ph No.', 'tel')}
      ${textField('farmer.note', f.note, 'Note')}
      ${textField('farmer.updatedName', f.updatedName, 'Update Name (if changed)')}
      ${textField('farmer.updatedPhone', f.updatedPhone, 'Update Phone Number (if changed)', 'tel')}
    </div>`;
  }

  // ===================== STEP 3: Coffee Area =====================
  function stepCoffeeArea() {
    const c = state.coffeeArea;
    return `<div class="step-body">
      ${textField('coffeeArea.totalHaMar2025', c.totalHaMar2025, 'Total Coffee Area (Ha) Mar 2025', 'number', 'step="0.01"')}
      ${textField('coffeeArea.totalHaCurrent', c.totalHaCurrent, 'Total Coffee Area (Ha) — Current', 'number', 'step="0.01"')}
      ${textField('coffeeArea.additionalExpandingTreesPerHa', c.additionalExpandingTreesPerHa, 'Any Additional / Expanding Trees per Ha', 'number', 'step="0.01"')}
    </div>`;
  }

  // ===================== STEP 4: Additional Bearing =====================
  function stepAdditionalBearing() {
    const a = state.additionalBearing;
    return `<div class="step-body">
      <div class="section-label">Additional Bearing (Area &amp; Trees) in 2025</div>
      ${textField('additionalBearing.y2025Ha', a.y2025Ha, '2025 — Ha', 'number', 'step="0.01"')}
      ${textField('additionalBearing.y2025Trees', a.y2025Trees, '2025 — Trees', 'number')}
      <div class="section-label">Additional Bearing (Area &amp; Trees) in 2026</div>
      ${textField('additionalBearing.y2026Ha', a.y2026Ha, '2026 — Ha', 'number', 'step="0.01"')}
      ${textField('additionalBearing.y2026Trees', a.y2026Trees, '2026 — Trees', 'number')}
    </div>`;
  }

  // ===================== STEP 5: Bearing Area & Production =====================
  function stepBearingProduction() {
    const b = state.bearingArea;
    const p = state.production;
    return `<div class="step-body">
      <div class="section-label">Bearing Area (ha)</div>
      ${textField('bearingArea.y2024_25', b.y2024_25, '2024-25', 'number', 'step="0.01"')}
      ${textField('bearingArea.y2025_26', b.y2025_26, '2025-26', 'number', 'step="0.01"')}
      ${textField('bearingArea.y2026_27', b.y2026_27, '2026-27', 'number', 'step="0.01"')}
      ${textField('bearingArea.y2027_28', b.y2027_28, '2027-28', 'number', 'step="0.01"')}
      <div class="section-label">Production (Quintals)</div>
      ${textField('production.y2024_25', p.y2024_25, '2024-25', 'number', 'step="0.01"')}
      ${textField('production.y2025_26', p.y2025_26, '2025-26', 'number', 'step="0.01"')}
      ${textField('production.y2026_27', p.y2026_27, '2026-27', 'number', 'step="0.01"')}
      ${textField('production.y2027_28', p.y2027_28, '2027-28', 'number', 'step="0.01"')}
    </div>`;
  }

  // ===================== STEP 6: Selling of 2026-27 crop (Quintals) =====================
  function stepSelling() {
    const s = state.selling2026_27;
    const months = [
      ['nov25', 'Nov-25'], ['dec25', 'Dec-25'], ['jan26', 'Jan-26'], ['feb26', 'Feb-26'],
      ['mar26', 'Mar-26'], ['apr26', 'Apr-26'], ['may26', 'May-26'], ['jun26', 'Jun-26'],
      ['jul26', 'Jul-26'], ['aug26', 'Aug-26'], ['sep26', 'Sep-26'], ['oct26', 'Oct-26'],
      ['nov26', 'Nov-26'], ['dec26', 'Dec-26'], ['undecided', 'Undecided'],
    ];
    return `<div class="step-body">
      <div class="section-label">Selling of 2026-27 Crop (Quintals) by Month</div>
      ${months.map(([key, label]) => textField(`selling2026_27.${key}`, s[key], label, 'number', 'step="0.01"')).join('')}
    </div>`;
  }

  // ===================== STEP 7: Stock & Fly Crop Outlook =====================
  function stepStockFlyOutlook() {
    const st = state.stock;
    const fc = state.flyCrop;
    return `<div class="step-body">
      <div class="section-label">Stock</div>
      ${textField('stock.actual2026_27Quintal', st.actual2026_27Quintal, 'Actual Stock 2026-27 Coffee at Home (Quintal)', 'number', 'step="0.01"')}
      ${textField('stock.regionPct', st.regionPct, 'Stock in the Region (%)', 'number', 'step="0.1"')}
      <div class="section-label">Fly Crop Outlook</div>
      ${selectField('flyCrop.compareToLY', fc.compareToLY, 'Fly Crop Compared to Last Year', FLY_CROP_COMPARE)}
    </div>`;
  }

  // ===================== STEP 8: Fly Crop Volumes =====================
  function stepFlyCropVolumes() {
    const h = state.flyCrop.harvesting;
    const s = state.flyCrop.selling;
    return `<div class="step-body">
      <div class="section-label">Harvesting Fly Crop of 2027-28 Crop (Quintals)</div>
      ${textField('flyCrop.harvesting.nov26', h.nov26, 'Nov-26', 'number', 'step="0.01"')}
      ${textField('flyCrop.harvesting.dec26', h.dec26, 'Dec-26', 'number', 'step="0.01"')}
      ${textField('flyCrop.harvesting.jan27', h.jan27, 'Jan-27', 'number', 'step="0.01"')}
      ${textField('flyCrop.harvesting.feb27', h.feb27, 'Feb-27', 'number', 'step="0.01"')}
      <div class="section-label">Selling Fly Crop of 2027-28 Crop (Quintals)</div>
      ${textField('flyCrop.selling.nov26', s.nov26, 'Nov-26', 'number', 'step="0.01"')}
      ${textField('flyCrop.selling.dec26', s.dec26, 'Dec-26', 'number', 'step="0.01"')}
      ${textField('flyCrop.selling.jan27', s.jan27, 'Jan-27', 'number', 'step="0.01"')}
      ${textField('flyCrop.selling.feb27', s.feb27, 'Feb-27', 'number', 'step="0.01"')}
    </div>`;
  }

  // ===================== STEP 9: Main Crop Outlook =====================
  function stepMainCrop() {
    const m = state.mainCrop;
    return `<div class="step-body">
      ${selectField('mainCrop.compareToLY', m.compareToLY, 'Main Crop Compared to Last Year', MAIN_CROP_COMPARE)}
      ${selectField('mainCrop.reason', m.reason, 'Reason', MAIN_CROP_REASON)}
      ${selectField('mainCrop.startMonth', m.startMonth, 'Main Crop Start Month', START_MONTH_OPTIONS)}
      ${selectField('mainCrop.peakHarvestMonth', m.peakHarvestMonth, 'Peak Harvest Month', PEAK_HARVEST_MONTH_OPTIONS)}
    </div>`;
  }

  // ===================== STEP 10: Weather & Crop Development =====================
  function stepWeatherDev() {
    const w = state.weatherDev;
    return `<div class="step-body">
      <div class="section-label">Rainfall for 2027-28 Crop Developmental Stages</div>
      ${selectField('weatherDev.rainfallBlossom', w.rainfallBlossom, 'Blossom', RAINFALL_OPTIONS)}
      ${selectField('weatherDev.rainfallFruitSet', w.rainfallFruitSet, 'Fruit Set', RAINFALL_OPTIONS)}
      <div class="section-label">2027-28 Crop Development</div>
      ${selectField('weatherDev.devBlossom', w.devBlossom, 'Blossom', CROP_DEV_OPTIONS)}
      ${selectField('weatherDev.devFruitSet', w.devFruitSet, 'Fruit Set', CROP_DEV_OPTIONS)}
      ${selectField('weatherDev.damage', w.damage, 'Damage', DAMAGE_OPTIONS)}
      ${toggleField('weatherDev.rainsAtOpeningBlossom', w.rainsAtOpeningBlossom, 'Rains at Opening Blossom')}
    </div>`;
  }

  // ===================== STEP 11: Price & Market =====================
  function stepPriceMarket() {
    const pm = state.priceMarket;
    return `<div class="step-body">
      <div class="section-label">Price of Coffee (IDR/Kg)</div>
      ${textField('priceMarket.avgPriceSold2025_26', pm.avgPriceSold2025_26, 'Average Price They Sold 2025-26 Coffee', 'number')}
      ${textField('priceMarket.existingPrice', pm.existingPrice, 'Existing Price', 'number')}
      ${textField('priceMarket.expectedPrice', pm.expectedPrice, 'Expected Price', 'number')}
      ${selectField('priceMarket.opinionCurrentPrice', pm.opinionCurrentPrice, 'Opinion for Current Price', OPINION_PRICE_OPTIONS)}
      ${selectField('priceMarket.futurePrice', pm.futurePrice, 'Future Price', FUTURE_PRICE_OPTIONS)}
      ${selectField('priceMarket.reactionToHigherPrice', pm.reactionToHigherPrice, 'Reaction to Recent Higher Price', REACTION_OPTIONS)}
    </div>`;
  }

  // ===================== STEP 12: Labor & Inputs =====================
  function stepLaborInputs() {
    const li = state.laborInputs;
    const fert = li.fertilizer;
    return `<div class="step-body">
      <div class="section-label">Average Labor Wages (IDR/day)</div>
      ${textField('laborInputs.wage2025', li.wage2025, '2025', 'number')}
      ${textField('laborInputs.wage2026', li.wage2026, '2026', 'number')}
      <div class="section-label">Herbicides</div>
      ${selectField('laborInputs.herbicideType', li.herbicideType, 'Application of Herbicides', HERBICIDE_TYPE_OPTIONS)}
      ${textField('laborInputs.herbicideLitersPerYear', li.herbicideLitersPerYear, 'Herbicides per Year (liter)', 'number', 'step="0.1"')}
      <div class="section-label">Application of Fertilizers (Quintal)</div>
      ${textField('laborInputs.fertilizer.npk2025', fert.npk2025, 'NPK — 2025', 'number', 'step="0.01"')}
      ${textField('laborInputs.fertilizer.npk2026', fert.npk2026, 'NPK — 2026', 'number', 'step="0.01"')}
      ${textField('laborInputs.fertilizer.urea2025', fert.urea2025, 'Urea — 2025', 'number', 'step="0.01"')}
      ${textField('laborInputs.fertilizer.urea2026', fert.urea2026, 'Urea — 2026', 'number', 'step="0.01"')}
      ${textField('laborInputs.fertilizer.tsp2025', fert.tsp2025, 'TSP — 2025', 'number', 'step="0.01"')}
      ${textField('laborInputs.fertilizer.tsp2026', fert.tsp2026, 'TSP — 2026', 'number', 'step="0.01"')}
    </div>`;
  }

  // ===================== STEP 13: Photos =====================
  function stepPhotos() {
    const photos = state.photos;
    const cards = PHOTO_CATEGORIES.map(cat => {
      const p = photos.find(x => x.category === cat);
      return `<div class="photo-card">
        <div class="photo-card-label">${cat}</div>
        ${p ? `<img src="${p.dataUrl}" class="photo-thumb"/><div class="photo-meta">📍${state.location.lat || '—'},${state.location.lon || '—'} · ${new Date(p.takenAt).toLocaleString()}</div>`
            : `<div class="photo-placeholder">No photo</div>`}
        <input type="file" accept="image/*" capture="environment" data-photo-cat="${cat}" style="margin-top:6px"/>
      </div>`;
    }).join('');
    return `<div class="step-body"><div class="photo-grid">${cards}</div></div>`;
  }

  // ===================== STEP 14: Review =====================
  function stepReview() {
    const s = state;
    return `<div class="step-body review-body">
      <h4>Survey Summary</h4>
      <div class="review-grid">
        <div><b>Survey ID</b><span>${s.id}</span></div>
        <div><b>Sample No.</b><span>${s.sampleNo || '—'}</span></div>
        <div><b>Date</b><span>${s.surveyDate}</span></div>
        <div><b>Surveyor</b><span>${s.surveyor || '—'}</span></div>
        <div><b>Coffee Type</b><span>${s.coffeeType}</span></div>
        <div><b>Province / District</b><span>${s.location.province || '—'} / ${s.location.district || '—'}</span></div>
        <div><b>GPS</b><span>${s.location.lat ? `${s.location.lat}, ${s.location.lon}` : 'Not captured'}</span></div>
        <div><b>Farmer</b><span>${s.farmer.name || '—'} (${s.farmer.phone || '—'})</span></div>
        <div><b>Total Coffee Area (Current)</b><span>${s.coffeeArea.totalHaCurrent ?? '—'} ha</span></div>
        <div><b>Production 2026-27 (Quintals)</b><span>${s.production.y2026_27 ?? '—'}</span></div>
        <div><b>Fly Crop vs LY</b><span>${s.flyCrop.compareToLY || '—'}</span></div>
        <div><b>Main Crop vs LY</b><span>${s.mainCrop.compareToLY || '—'}</span></div>
        <div><b>Existing Price</b><span>${s.priceMarket.existingPrice ?? '—'} IDR/Kg</span></div>
        <div><b>Photos</b><span>${s.photos.length} / ${PHOTO_CATEGORIES.length}</span></div>
      </div>
      <p class="muted">Please review all sections before submitting. You can navigate back to any step to make corrections.</p>
    </div>`;
  }

  function renderStepBody() {
    switch (STEPS[stepIndex]) {
      case 'Sample & Location': return stepSampleLocation();
      case 'Farmer': return stepFarmer();
      case 'Coffee Area': return stepCoffeeArea();
      case 'Additional Bearing': return stepAdditionalBearing();
      case 'Bearing & Production': return stepBearingProduction();
      case 'Selling 2026-27': return stepSelling();
      case 'Stock & Fly Crop Outlook': return stepStockFlyOutlook();
      case 'Fly Crop Volumes': return stepFlyCropVolumes();
      case 'Main Crop Outlook': return stepMainCrop();
      case 'Weather & Crop Development': return stepWeatherDev();
      case 'Price & Market': return stepPriceMarket();
      case 'Labor & Inputs': return stepLaborInputs();
      case 'Photos': return stepPhotos();
      case 'Review': return stepReview();
      default: return '';
    }
  }

  function render() {
    const pct = Math.round(((stepIndex) / (STEPS.length - 1)) * 100);
    container.innerHTML = `
      <div class="wizard">
        <div class="wizard-header">
          <button type="button" id="btn-close-wizard" class="btn-icon">✕</button>
          <div class="wizard-title">${STEPS[stepIndex]}</div>
          <div class="wizard-step-count">${stepIndex + 1}/${STEPS.length}</div>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="wizard-body" id="wizard-body">${renderStepBody()}</div>
        <div class="wizard-footer">
          <button type="button" id="btn-save-draft" class="btn-secondary">Save Draft</button>
          ${stepIndex > 0 ? '<button type="button" id="btn-prev" class="btn-secondary">◀ Previous</button>' : ''}
          ${stepIndex < STEPS.length - 1
            ? '<button type="button" id="btn-next" class="btn-primary">Next ▶</button>'
            : '<button type="button" id="btn-submit" class="btn-primary btn-submit">✓ Submit Survey</button>'}
        </div>
      </div>`;
    bindEvents();
  }

  function bindEvents() {
    const body = Utils.qs('#wizard-body', container);

    Utils.qsa('input[data-field], select[data-field], textarea[data-field]', body).forEach(inputEl => {
      inputEl.addEventListener('change', (e) => {
        const field = e.target.getAttribute('data-field');
        let val = e.target.value;
        if (e.target.type === 'number') val = val === '' ? null : parseFloat(val);
        setNested(state, field, val);
        renderKeepStep();
      });
    });

    Utils.qsa('.chip[data-field]', body).forEach(btn => {
      btn.addEventListener('click', () => {
        setNested(state, btn.getAttribute('data-field'), btn.getAttribute('data-value'));
        renderKeepStep();
      });
    });

    Utils.qsa('.toggle-btn[data-field]', body).forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.getAttribute('data-field');
        setNested(state, field, !getNested(state, field));
        renderKeepStep();
      });
    });

    const gpsBtn = Utils.qs('#btn-capture-gps', body);
    if (gpsBtn) gpsBtn.addEventListener('click', async () => {
      gpsBtn.textContent = '📍 Capturing...';
      try {
        const pos = await Geo.getPosition();
        state.location.lat = pos.lat; state.location.lon = pos.lon;
        state.location.accuracyM = pos.accuracy;
        if (pos.altitude) state.location.altitude = pos.altitude;
        App.toast('GPS captured successfully.');
      } catch (e) {
        App.toast('GPS capture failed: ' + e.message, 'error');
      }
      renderKeepStep();
    });

    Utils.qsa('input[data-photo-cat]', body).forEach(inp => {
      inp.addEventListener('change', (e) => {
        const cat = inp.getAttribute('data-photo-cat');
        const file = e.target.files[0];
        if (!file) return;
        compressAndStore(file).then(dataUrl => {
          const existingIdx = state.photos.findIndex(p => p.category === cat);
          const photoRec = {
            photoId: Utils.uid('PHOTO'), category: cat, dataUrl,
            takenAt: Utils.nowIso(), lat: state.location.lat, lon: state.location.lon, surveyId: state.id,
          };
          if (existingIdx >= 0) state.photos[existingIdx] = photoRec; else state.photos.push(photoRec);
          renderKeepStep();
        });
      });
    });

    const closeBtn = Utils.qs('#btn-close-wizard', container);
    if (closeBtn) closeBtn.addEventListener('click', () => confirmExit());

    const saveDraftBtn = Utils.qs('#btn-save-draft', container);
    if (saveDraftBtn) saveDraftBtn.addEventListener('click', async () => {
      await Sync.saveDraft(state);
      App.toast('Draft saved locally.');
    });

    const prevBtn = Utils.qs('#btn-prev', container);
    if (prevBtn) prevBtn.addEventListener('click', () => { stepIndex = Math.max(0, stepIndex - 1); render(); });

    const nextBtn = Utils.qs('#btn-next', container);
    if (nextBtn) nextBtn.addEventListener('click', async () => {
      stepIndex = Math.min(STEPS.length - 1, stepIndex + 1);
      await Sync.saveDraft(state); // autosave each step
      render();
    });

    const submitBtn = Utils.qs('#btn-submit', container);
    if (submitBtn) submitBtn.addEventListener('click', async () => {
      const user = Auth.currentUser();
      await Sync.queueForSync(state);
      await DB.logAudit(user, 'SUBMIT_SURVEY', 'survey', state.id, `Submitted by ${user?.name}`);
      App.toast(Sync.isOnline() ? 'Survey submitted & syncing...' : 'Survey saved. Will sync when online.');
      App.navigate('#/surveys');
    });
  }

  function renderKeepStep() { render(); }

  function confirmExit() {
    if (confirm('Save this survey as a draft before exiting?')) {
      Sync.saveDraft(state).then(() => App.navigate('#/surveys'));
    } else {
      App.navigate('#/surveys');
    }
  }

  // ---- basic client-side photo compression via canvas ----
  function compressAndStore(file, maxDim = 900, quality = 0.7) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxDim) { height = height * (maxDim / width); width = maxDim; }
          else if (height > maxDim) { width = width * (maxDim / height); height = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  return { start, blankSurvey };
})();
