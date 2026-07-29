// ============================================================================
// survey-form.js — Multi-step "Crop Tour Questionnaire" wizard.
// Field-for-field rebuild matching QN.xlsx exactly: all 75 questionnaire
// columns, in original column order (A..BW), with the exact coded dropdown
// options taken verbatim from the spreadsheet's header legends.
//
// Steps (grouped by the spreadsheet's merged header sections):
//   1. Sample & Farmer            (cols A-H)
//   2. Coffee Area                (cols I-K)
//   3. Additional Bearing         (cols L-O)
//   4. Bearing Area               (cols P-S)
//   5. Production                 (cols T-W)
//   6. Selling 2026-27 Crop        (cols X-AL, 15 months)
//   7. Stock & Fly Crop Outlook   (cols AM-AO)
//   8. Fly Crop Volumes           (cols AP-AW)
//   9. Main Crop Outlook          (cols AX-BA)
//  10. Weather & Crop Development (cols BB-BG)
//  11. Price of Coffee            (cols BH-BM)
//  12. Labor & Inputs             (cols BN-BW)
//  13. Photos (app feature, not a spreadsheet column — optional field docs)
//  14. Review
//
// Notes on deviations from the raw spreadsheet (kept minimal, for app use):
//  - Survey Date, Surveyor are app metadata needed to file/audit each record.
//  - GPS capture is an optional app feature for the map view; it is NOT one
//    of the 75 questionnaire columns and has no bearing on QN.xlsx export.
// Autosaves to IndexedDB 'drafts' store on every step change ("Save Draft").
// ============================================================================

const SurveyForm = (() => {
  let state = null;
  let stepIndex = 0;
  let container = null;
  let refData = { provinces: [], islands: [], surveyors: [] };

  const STEPS = [
    'Sample & Farmer', 'Coffee Area', 'Additional Bearing', 'Bearing Area',
    'Production', 'Selling 2026-27 Crop', 'Stock & Fly Crop Outlook',
    'Fly Crop Volumes', 'Main Crop Outlook', 'Weather & Crop Development',
    'Price of Coffee', 'Labor & Inputs', 'Photos', 'Review',
  ];

  // ---- Coded option lists copied verbatim from QN.xlsx header legends ----
  const FLY_CROP_COMPARE = ['1 - Higher', '2 - Same', '3 - Lower'];
  const MAIN_CROP_COMPARE = ['1 - Early', '2 - Same', '3 - Late'];
  const MAIN_CROP_REASON = ['1 - Rains', '2 - Flowering', '3 - Dryness'];
  const START_MONTH_OPTIONS = ['3', '4', '5'];
  const PEAK_HARVEST_MONTH_OPTIONS = ['5', '6', '7', '8'];
  const RAINFALL_OPTIONS = ['BN - Below Normal', 'N - Normal', 'AN - Above Normal', 'Ex - Excessive'];
  const CROP_DEV_OPTIONS = ['BN - Below Normal', 'N - Normal', 'AN - Above Normal'];
  const DAMAGE_OPTIONS = [
    '1 - Blossom', '2 - Fruit set', '3 - 1 and 2', '4 - Cherry development',
    '5 - 2 and 4', '6 - 1 and 4', '7 - All 3 stages', '8 - No damage',
  ];
  const OPINION_PRICE_OPTIONS = ['1 - Happy', '2 - Not Happy'];
  const FUTURE_PRICE_OPTIONS = ['B - Bullish', 'N - Neutral', 'S - Bearish'];
  const REACTION_OPTIONS = [
    '1 - Increase grafting', '2 - Increase fertilizer', '3 - Better husbandry (other than fertilizer)',
    '4 - Expanding area', '5 - Improve drying yard', '6 - Renovate house',
    '7 - Buying car/motorcycle', '8 - No change',
  ];
  const HERBICIDE_TYPE_OPTIONS = ['1 - Glifosat', '2 - Paraquat', '3 - 2,4-D', '4 - Combine', '5 - Others'];
  const PHOTO_CATEGORIES = ['Farm / Coffee Area', 'Trees / Cherries', 'Farmer Reference', 'Other'];

  // ---- Flat field model: one key per QN.xlsx column, in column order ----
  function blankSurvey() {
    const user = Auth.currentUser();
    return {
      id: Utils.uid('DRAFT'),
      status: 'draft',
      createdAt: Utils.nowIso(),
      updatedAt: Utils.nowIso(),

      // App metadata (not a QN.xlsx column, needed to file/audit the record)
      surveyor: user ? user.name : '',
      surveyDate: new Date().toISOString().slice(0, 10),
      gps: { lat: null, lon: null, accuracyM: null },

      // Col A-C: Identification
      sampleNo: '',
      province: '',
      district: '',

      // Col D-H: Farmers
      farmerId: '',
      farmerName: '',
      farmerPhNo: '',
      farmerNote: '',
      farmerUpdateName: '',
      farmerUpdatePhoneNumber: '',

      // Col I-K: Coffee Area
      totalCoffeeAreaHaMar2025: null,
      totalCoffeeAreaHa: null,
      additionalExpandingTreesPerHa: null,

      // Col L-O: Additional bearing (area and trees)
      addBearing2025Ha: null,
      addBearing2025Trees: null,
      addBearing2026Ha: null,
      addBearing2026Trees: null,

      // Col P-S: Bearing Area (ha)
      bearingArea2024_25: null,
      bearingArea2025_26: null,
      bearingArea2026_27: null,
      bearingArea2027_28: null,

      // Col T-W: Production (Quintals)
      production2024_25: null,
      production2025_26: null,
      production2026_27: null,
      production2027_28: null,

      // Col X-AL: Selling of 2026-27 crop (Quintals)
      sellingNov25: null, sellingDec25: null, sellingJan26: null, sellingFeb26: null,
      sellingMar26: null, sellingApr26: null, sellingMay26: null, sellingJun26: null,
      sellingJul26: null, sellingAug26: null, sellingSep26: null, sellingOct26: null,
      sellingNov26: null, sellingDec26: null, sellingUndecided: null,

      // Col AM-AN: Stock
      actualStock202627Quintal: null,
      stockRegionPct: null,

      // Col AO: Fly crop outlook
      flyCropCompareToLY: '',

      // Col AP-AS: Harvesting Fly Crop of 2027-28 crop
      flyHarvestNov26: null, flyHarvestDec26: null, flyHarvestJan27: null, flyHarvestFeb27: null,

      // Col AT-AW: Selling Fly Crop of 2027-28 crop
      flySellNov26: null, flySellDec26: null, flySellJan27: null, flySellFeb27: null,

      // Col AX-BA: Main crop outlook
      mainCropCompareToLY: '',
      mainCropReason: '',
      mainCropStartMonth: '',
      peakHarvestMonth: '',

      // Col BB-BG: Weather & crop development
      rainfallBlossom: '',
      rainfallFruitSet: '',
      devBlossom: '',
      devFruitSet: '',
      damage: '',
      rainsAtOpeningBlossom: false,

      // Col BH-BM: Price of coffee (IDR/Kg)
      avgPriceSold2025_26: null,
      existingPrice: null,
      expectedPrice: null,
      opinionCurrentPrice: '',
      futurePrice: '',
      reactionHigherPrice: '',

      // Col BN-BW: Labor & inputs
      laborWage2025: null,
      laborWage2026: null,
      herbicideType: '',
      herbicideLitersPerYear: null,
      npk2025: null, npk2026: null,
      urea2025: null, urea2026: null,
      tsp2025: null, tsp2026: null,

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
      <button type="button" class="toggle-btn ${value ? 'on' : ''}" data-field="${name}" data-toggle="1">${value ? 'Y' : 'N'}</button>
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

  // ===================== STEP 1: Sample & Farmer (cols A-H) =====================
  function stepSampleFarmer() {
    const s = state;
    return `
      <div class="step-body">
        <div class="section-label">App Metadata</div>
        ${textField('surveyDate', s.surveyDate, 'Survey Date', 'date')}
        ${selectField('surveyor', s.surveyor, 'Surveyor Name', refData.surveyors)}
        <div class="field">
          <label>GPS (optional, for map view)</label>
          <div class="gps-row">
            <input type="text" readonly value="${s.gps.lat && s.gps.lon ? `${s.gps.lat}, ${s.gps.lon} (±${s.gps.accuracyM || '?'}m)` : 'Not captured'}"/>
            <button type="button" id="btn-capture-gps" class="btn-secondary">📍 Capture GPS</button>
          </div>
        </div>
        <div class="section-label">Sample No. / Province / District</div>
        ${textField('sampleNo', s.sampleNo, 'Sample No.')}
        ${selectField('province', s.province, 'Province', refData.provinces)}
        ${textField('district', s.district, 'District')}
        <div class="section-label">Farmers</div>
        ${textField('farmerId', s.farmerId, 'Farmer ID')}
        ${textField('farmerName', s.farmerName, 'Name')}
        ${textField('farmerPhNo', s.farmerPhNo, 'Ph No.', 'tel')}
        ${textField('farmerNote', s.farmerNote, 'Note')}
        ${textField('farmerUpdateName', s.farmerUpdateName, 'Update Name')}
        ${textField('farmerUpdatePhoneNumber', s.farmerUpdatePhoneNumber, 'Phone number', 'tel')}
      </div>`;
  }

  // ===================== STEP 2: Coffee Area (cols I-K) =====================
  function stepCoffeeArea() {
    const s = state;
    return `<div class="step-body">
      ${textField('totalCoffeeAreaHaMar2025', s.totalCoffeeAreaHaMar2025, 'Total Coffee Area (Ha) Mar 2025', 'number', 'step="0.01"')}
      ${textField('totalCoffeeAreaHa', s.totalCoffeeAreaHa, 'Total Coffee Area (Ha)', 'number', 'step="0.01"')}
      ${textField('additionalExpandingTreesPerHa', s.additionalExpandingTreesPerHa, 'Any Additional/Expanding Trees/Ha', 'number', 'step="0.01"')}
    </div>`;
  }

  // ===================== STEP 3: Additional Bearing (cols L-O) =====================
  function stepAdditionalBearing() {
    const s = state;
    return `<div class="step-body">
      <div class="section-label">Additional Bearing (Area and Trees) in 2025</div>
      ${textField('addBearing2025Ha', s.addBearing2025Ha, 'Ha', 'number', 'step="0.01"')}
      ${textField('addBearing2025Trees', s.addBearing2025Trees, 'Trees', 'number')}
      <div class="section-label">Additional Bearing (Area and Trees) in 2026</div>
      ${textField('addBearing2026Ha', s.addBearing2026Ha, 'Ha', 'number', 'step="0.01"')}
      ${textField('addBearing2026Trees', s.addBearing2026Trees, 'Trees', 'number')}
    </div>`;
  }

  // ===================== STEP 4: Bearing Area (ha) (cols P-S) =====================
  function stepBearingArea() {
    const s = state;
    return `<div class="step-body">
      <div class="section-label">Bearing Area (ha)</div>
      ${textField('bearingArea2024_25', s.bearingArea2024_25, '2024-25', 'number', 'step="0.01"')}
      ${textField('bearingArea2025_26', s.bearingArea2025_26, '2025-26', 'number', 'step="0.01"')}
      ${textField('bearingArea2026_27', s.bearingArea2026_27, '2026-27', 'number', 'step="0.01"')}
      ${textField('bearingArea2027_28', s.bearingArea2027_28, '2027-28', 'number', 'step="0.01"')}
    </div>`;
  }

  // ===================== STEP 5: Production (Quintals) (cols T-W) =====================
  function stepProduction() {
    const s = state;
    return `<div class="step-body">
      <div class="section-label">Production (Quintals)</div>
      ${textField('production2024_25', s.production2024_25, '2024-25', 'number', 'step="0.01"')}
      ${textField('production2025_26', s.production2025_26, '2025-26', 'number', 'step="0.01"')}
      ${textField('production2026_27', s.production2026_27, '2026-27', 'number', 'step="0.01"')}
      ${textField('production2027_28', s.production2027_28, '2027-28', 'number', 'step="0.01"')}
    </div>`;
  }

  // ===================== STEP 6: Selling of 2026-27 crop (Quintals) (cols X-AL) =====================
  function stepSelling() {
    const s = state;
    const months = [
      ['sellingNov25', 'Nov-25'], ['sellingDec25', 'Dec-25'], ['sellingJan26', 'Jan-26'], ['sellingFeb26', 'Feb-26'],
      ['sellingMar26', 'Mar-26'], ['sellingApr26', 'Apr-26'], ['sellingMay26', 'May-26'], ['sellingJun26', 'Jun-26'],
      ['sellingJul26', 'Jul-26'], ['sellingAug26', 'Aug-26'], ['sellingSep26', 'Sep-26'], ['sellingOct26', 'Oct-26'],
      ['sellingNov26', 'Nov-26'], ['sellingDec26', 'Dec-26'], ['sellingUndecided', 'Undecided'],
    ];
    return `<div class="step-body">
      <div class="section-label">Selling of 2026-27 Crop (Quintals)</div>
      ${months.map(([key, label]) => textField(key, s[key], label, 'number', 'step="0.01"')).join('')}
    </div>`;
  }

  // ===================== STEP 7: Stock & Fly Crop Outlook (cols AM-AO) =====================
  function stepStockFlyOutlook() {
    const s = state;
    return `<div class="step-body">
      ${textField('actualStock202627Quintal', s.actualStock202627Quintal, 'Actual Stock 2026-27 Coffee at Home (Quintal)', 'number', 'step="0.01"')}
      ${textField('stockRegionPct', s.stockRegionPct, 'Stock in the Region (%)', 'number', 'step="0.1"')}
      ${selectField('flyCropCompareToLY', s.flyCropCompareToLY, 'Fly Crop Compare to LY', FLY_CROP_COMPARE)}
    </div>`;
  }

  // ===================== STEP 8: Fly Crop Volumes (cols AP-AW) =====================
  function stepFlyCropVolumes() {
    const s = state;
    return `<div class="step-body">
      <div class="section-label">Harvesting Fly Crop of 2027-28 Crop (Quintals)</div>
      ${textField('flyHarvestNov26', s.flyHarvestNov26, 'Nov-26', 'number', 'step="0.01"')}
      ${textField('flyHarvestDec26', s.flyHarvestDec26, 'Dec-26', 'number', 'step="0.01"')}
      ${textField('flyHarvestJan27', s.flyHarvestJan27, 'Jan-27', 'number', 'step="0.01"')}
      ${textField('flyHarvestFeb27', s.flyHarvestFeb27, 'Feb-27', 'number', 'step="0.01"')}
      <div class="section-label">Selling Fly Crop of 2027-28 Crop (Quintals)</div>
      ${textField('flySellNov26', s.flySellNov26, 'Nov-26', 'number', 'step="0.01"')}
      ${textField('flySellDec26', s.flySellDec26, 'Dec-26', 'number', 'step="0.01"')}
      ${textField('flySellJan27', s.flySellJan27, 'Jan-27', 'number', 'step="0.01"')}
      ${textField('flySellFeb27', s.flySellFeb27, 'Feb-27', 'number', 'step="0.01"')}
    </div>`;
  }

  // ===================== STEP 9: Main Crop Outlook (cols AX-BA) =====================
  function stepMainCrop() {
    const s = state;
    return `<div class="step-body">
      ${selectField('mainCropCompareToLY', s.mainCropCompareToLY, 'Main Crop Compare to LY', MAIN_CROP_COMPARE)}
      ${selectField('mainCropReason', s.mainCropReason, 'Reason', MAIN_CROP_REASON)}
      ${selectField('mainCropStartMonth', s.mainCropStartMonth, 'Main Crop Start Month (3=Mar, 4=Apr, 5=May)', START_MONTH_OPTIONS)}
      ${selectField('peakHarvestMonth', s.peakHarvestMonth, 'Peak Harvest Month (5=May, 6=Jun, 7=Jul, 8=Aug)', PEAK_HARVEST_MONTH_OPTIONS)}
    </div>`;
  }

  // ===================== STEP 10: Weather & Crop Development (cols BB-BG) =====================
  function stepWeatherDev() {
    const s = state;
    return `<div class="step-body">
      <div class="section-label">Rainfall for 2027-28 Crop Developmental Stages</div>
      ${selectField('rainfallBlossom', s.rainfallBlossom, 'Blossom', RAINFALL_OPTIONS)}
      ${selectField('rainfallFruitSet', s.rainfallFruitSet, 'Fruit Set', RAINFALL_OPTIONS)}
      <div class="section-label">2027-28 Crop Development</div>
      ${selectField('devBlossom', s.devBlossom, 'Blossom', CROP_DEV_OPTIONS)}
      ${selectField('devFruitSet', s.devFruitSet, 'Fruit Set', CROP_DEV_OPTIONS)}
      ${selectField('damage', s.damage, 'Damage', DAMAGE_OPTIONS)}
      ${toggleField('rainsAtOpeningBlossom', s.rainsAtOpeningBlossom, 'Rains at Opening Blossom (Y/N)')}
    </div>`;
  }

  // ===================== STEP 11: Price of Coffee (IDR/Kg) (cols BH-BM) =====================
  function stepPrice() {
    const s = state;
    return `<div class="step-body">
      ${textField('avgPriceSold2025_26', s.avgPriceSold2025_26, 'Average Price They Sold 2025-26 Coffee', 'number')}
      ${textField('existingPrice', s.existingPrice, 'Existing', 'number')}
      ${textField('expectedPrice', s.expectedPrice, 'Expected', 'number')}
      ${selectField('opinionCurrentPrice', s.opinionCurrentPrice, 'Opinion for Current Price', OPINION_PRICE_OPTIONS)}
      ${selectField('futurePrice', s.futurePrice, 'Future Price', FUTURE_PRICE_OPTIONS)}
      ${selectField('reactionHigherPrice', s.reactionHigherPrice, 'Reaction to Recent Higher Price', REACTION_OPTIONS)}
    </div>`;
  }

  // ===================== STEP 12: Labor & Inputs (cols BN-BW) =====================
  function stepLaborInputs() {
    const s = state;
    return `<div class="step-body">
      <div class="section-label">Average Labor Wages (IDR/day)</div>
      ${textField('laborWage2025', s.laborWage2025, '2025', 'number')}
      ${textField('laborWage2026', s.laborWage2026, '2026', 'number')}
      <div class="section-label">Herbicides</div>
      ${selectField('herbicideType', s.herbicideType, 'Application of Herbicides', HERBICIDE_TYPE_OPTIONS)}
      ${textField('herbicideLitersPerYear', s.herbicideLitersPerYear, 'Application of Herbicides Per Year (liter)', 'number', 'step="0.1"')}
      <div class="section-label">Application of Fertilizers (Quintal)</div>
      ${textField('npk2025', s.npk2025, 'NPK - 2025', 'number', 'step="0.01"')}
      ${textField('npk2026', s.npk2026, 'NPK - 2026', 'number', 'step="0.01"')}
      ${textField('urea2025', s.urea2025, 'Urea - 2025', 'number', 'step="0.01"')}
      ${textField('urea2026', s.urea2026, 'Urea - 2026', 'number', 'step="0.01"')}
      ${textField('tsp2025', s.tsp2025, 'TSP - 2025', 'number', 'step="0.01"')}
      ${textField('tsp2026', s.tsp2026, 'TSP - 2026', 'number', 'step="0.01"')}
    </div>`;
  }

  // ===================== STEP 13: Photos (app feature) =====================
  function stepPhotos() {
    const photos = state.photos;
    const cards = PHOTO_CATEGORIES.map(cat => {
      const p = photos.find(x => x.category === cat);
      return `<div class="photo-card">
        <div class="photo-card-label">${cat}</div>
        ${p ? `<img src="${p.dataUrl}" class="photo-thumb"/><div class="photo-meta">📍${state.gps.lat || '—'},${state.gps.lon || '—'} · ${new Date(p.takenAt).toLocaleString()}</div>`
            : `<div class="photo-placeholder">No photo</div>`}
        <input type="file" accept="image/*" capture="environment" data-photo-cat="${cat}" style="margin-top:6px"/>
      </div>`;
    }).join('');
    return `<div class="step-body"><p class="muted small">Optional app feature — not part of the official questionnaire.</p><div class="photo-grid">${cards}</div></div>`;
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
        <div><b>Province / District</b><span>${s.province || '—'} / ${s.district || '—'}</span></div>
        <div><b>Farmer ID</b><span>${s.farmerId || '—'}</span></div>
        <div><b>Farmer</b><span>${s.farmerName || '—'} (${s.farmerPhNo || '—'})</span></div>
        <div><b>Total Coffee Area (Ha)</b><span>${s.totalCoffeeAreaHa ?? '—'}</span></div>
        <div><b>Production 2026-27 (Quintals)</b><span>${s.production2026_27 ?? '—'}</span></div>
        <div><b>Fly Crop vs LY</b><span>${s.flyCropCompareToLY || '—'}</span></div>
        <div><b>Main Crop vs LY</b><span>${s.mainCropCompareToLY || '—'}</span></div>
        <div><b>Existing Price (IDR/Kg)</b><span>${s.existingPrice ?? '—'}</span></div>
        <div><b>Photos</b><span>${s.photos.length} / ${PHOTO_CATEGORIES.length}</span></div>
      </div>
      <p class="muted">Please review all sections before submitting. You can navigate back to any step to make corrections.</p>
    </div>`;
  }

  function renderStepBody() {
    switch (STEPS[stepIndex]) {
      case 'Sample & Farmer': return stepSampleFarmer();
      case 'Coffee Area': return stepCoffeeArea();
      case 'Additional Bearing': return stepAdditionalBearing();
      case 'Bearing Area': return stepBearingArea();
      case 'Production': return stepProduction();
      case 'Selling 2026-27 Crop': return stepSelling();
      case 'Stock & Fly Crop Outlook': return stepStockFlyOutlook();
      case 'Fly Crop Volumes': return stepFlyCropVolumes();
      case 'Main Crop Outlook': return stepMainCrop();
      case 'Weather & Crop Development': return stepWeatherDev();
      case 'Price of Coffee': return stepPrice();
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
        state.gps.lat = pos.lat; state.gps.lon = pos.lon;
        state.gps.accuracyM = pos.accuracy;
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
            takenAt: Utils.nowIso(), lat: state.gps.lat, lon: state.gps.lon, surveyId: state.id,
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
