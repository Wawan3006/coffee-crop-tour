// ============================================================================
// survey-form.js — Multi-step "New Crop Survey" wizard.
// Steps: Location -> Farm -> Crop Condition -> Sampling -> Harvest -> Weather
//        -> Farmer Interview -> Photos -> Review -> Submit
// Autosaves to IndexedDB 'drafts' store on every step change ("Save Draft").
// ============================================================================

const SurveyForm = (() => {
  let state = null; // the in-progress survey object
  let stepIndex = 0;
  let container = null;
  let refData = { provinces: [], islands: [], surveyors: [] };

  const STEPS = ['Location', 'Farm', 'Crop Condition', 'Sampling', 'Harvest', 'Weather', 'Interview', 'Photos', 'Review'];

  const VARIETIES = {
    Robusta: ["BP 42", "SA 237", "Robusta Lokal", "Tugu Sari", "BP 358"],
    Arabica: ["Typica", "Kartika", "Sigararutang", "Ateng Super", "Andungsari 2K", "S795"],
  };
  const SHADE = ["None", "Light", "Moderate", "Heavy"];
  const IRRIGATION = ["None", "Partial", "Full"];
  const CHERRY_STAGES = ["Flowering", "Green Cherry", "Maturing", "Ripe/Red Cherry", "Harvest Ongoing", "Harvest Complete"];
  const RAIN_COND = ["Below Normal", "Normal", "Above Normal"];
  const RAIN_VS_NORMAL = ["Much Lower", "Lower", "Normal", "Higher", "Much Higher"];
  const TEMP_COND = ["Cooler than normal", "Normal", "Warmer than normal"];
  const WATER_AVAIL = ["Sufficient", "Limited", "Scarce"];
  const FLOWER_COND = ["Poor", "Fair", "Good", "Excellent"];
  const EXPECT_VS_LAST = ["Much Lower", "Lower", "Similar", "Higher", "Much Higher"];
  const SELLING_INTENTION = ["Sell Immediately", "Hold for Better Price", "Partial Sell/Partial Hold", "Contract Committed"];
  const LABOR_AVAIL = ["Sufficient", "Tight", "Shortage"];
  const FERT_USAGE = ["None", "Organic Only", "Chemical Only", "Combined"];
  const CONCERNS = ["Pest Pressure", "Disease", "Labor Shortage", "Low Farmgate Price", "Fertilizer Cost", "Drought", "Excess Rain", "Aging Trees", "None"];

  function blankSurvey() {
    const user = Auth.currentUser();
    return {
      id: Utils.uid('DRAFT'),
      status: 'draft',
      createdAt: Utils.nowIso(),
      updatedAt: Utils.nowIso(),
      surveyor: user ? user.name : '',
      cropYear: new Date().getFullYear(),
      surveyDate: new Date().toISOString().slice(0, 10),
      location: { lat: null, lon: null, altitude: null, accuracyM: null, island: '', province: '', district: '', subdistrict: '', village: '' },
      coffeeType: 'Robusta',
      farm: { farmerName: '', farmerId: '', farmAreaHa: null, productiveAreaHa: null, productiveTrees: null, avgTreeAgeYears: null, variety: '', shadeLevel: '', irrigation: '' },
      cropCondition: { treeCondition: 3, flowering: 3, fruitSet: 3, cherryLoad: 3, beanDevelopment: 3, pestPressure: 3, diseasePressure: 3, soilMoisture: 3, overallCondition: 3 },
      harvestInfo: { mainFloweringPeriod: '', secondaryFlowering: '', currentCherryStage: 'Green Cherry', greenCherryPct: 25, yellowCherryPct: 25, redCherryPct: 25, harvestedPct: 25, estHarvestStart: '', estPeakHarvest: '', estHarvestCompletion: '' },
      cropEstimate: { previousProductionKg: null, currentEstimateKg: null, expectedSecondCropKg: null, expectedYieldPerHaKg: null, expectedYieldPerTreeG: null, changePct: null, outlook: 'Similar' },
      sampling: { trees: [], avgCherriesPerTree: null, avgGreenBeanEquivG: null, estimatedFarmYieldKg: null },
      weather: { rainfallCondition: 'Normal', rainfallVsNormal: 'Normal', drySpell: false, temperatureCondition: 'Normal', waterAvailability: 'Sufficient', floweringCondition: 'Good', fruitAbortion: false, droughtStress: false, excessiveRainfall: false, windDamage: false, pestDiseaseObservations: '', agronomistComments: '' },
      interview: { expectationVsLastYear: 'Similar', harvestTiming: 'On time', farmgatePriceIDR: null, sellingIntention: 'Hold for Better Price', pctAlreadySold: 0, laborAvailability: 'Sufficient', harvestLaborCostIDR: null, fertilizerUsage: 'Combined', fertilizerCostIDR: null, majorConcerns: 'None' },
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

  function calcCropEstimate() {
    const ce = state.cropEstimate;
    if (ce.previousProductionKg && ce.currentEstimateKg) {
      ce.changePct = Math.round(((ce.currentEstimateKg / ce.previousProductionKg) - 1) * 1000) / 10;
    } else {
      ce.changePct = null;
    }
    ce.outlook = Utils.outlookClass(ce.changePct);
    const pArea = state.farm.productiveAreaHa;
    const pTrees = state.farm.productiveTrees;
    ce.expectedYieldPerHaKg = (pArea && ce.currentEstimateKg) ? Math.round((ce.currentEstimateKg / pArea) * 10) / 10 : null;
    ce.expectedYieldPerTreeG = (pTrees && ce.currentEstimateKg) ? Math.round((ce.currentEstimateKg * 1000 / pTrees) * 10) / 10 : null;
  }

  function calcSampling() {
    const trees = state.sampling.trees;
    if (!trees.length) { state.sampling.avgCherriesPerTree = null; state.sampling.avgGreenBeanEquivG = null; state.sampling.estimatedFarmYieldKg = null; return; }
    trees.forEach(t => {
      t.estCherriesPerTree = Math.round((t.productiveBranches || 0) * (t.cherriesPerBranch || 0));
      t.estGreenBeanEquivG = Math.round((t.estCherriesPerTree * 1.7 / 5.5) * 10) / 10; // ~1.7g/cherry; ~5.5:1 cherry:green-bean by wt
    });
    state.sampling.avgCherriesPerTree = Math.round(Utils.mean(trees.map(t => t.estCherriesPerTree)) * 10) / 10;
    state.sampling.avgGreenBeanEquivG = Math.round(Utils.mean(trees.map(t => t.estGreenBeanEquivG)) * 10) / 10;
    const pTrees = state.farm.productiveTrees || 0;
    state.sampling.estimatedFarmYieldKg = Math.round((state.sampling.avgGreenBeanEquivG * pTrees / 1000) * 10) / 10;
  }

  function scoreSelector(name, value, label) {
    const buttons = [1, 2, 3, 4, 5].map(v => `
      <button type="button" class="score-btn ${v === value ? 'active' : ''}" data-field="${name}" data-value="${v}"
        style="${v === value ? `background:${Utils.scoreColor(v)};color:#fff;border-color:${Utils.scoreColor(v)}` : ''}">${v}</button>`).join('');
    return `<div class="field">
      <label>${label}</label>
      <div class="score-row">${buttons}</div>
    </div>`;
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

  function stepLocation() {
    const l = state.location;
    return `
      <div class="step-body">
        ${textField('surveyDate', state.surveyDate, 'Survey Date', 'date')}
        ${selectField('surveyor', state.surveyor, 'Surveyor Name', refData.surveyors)}
        ${textField('cropYear', state.cropYear, 'Crop Year', 'number')}
        <div class="field">
          <label>GPS Coordinates</label>
          <div class="gps-row">
            <input type="text" readonly value="${l.lat && l.lon ? `${l.lat}, ${l.lon} (±${l.accuracyM || '?'}m)` : 'Not captured yet'}"/>
            <button type="button" id="btn-capture-gps" class="btn-secondary">📍 Capture GPS</button>
          </div>
        </div>
        ${selectField('location.island', l.island, 'Island', refData.islands)}
        ${selectField('location.province', l.province, 'Province', refData.provinces)}
        ${textField('location.district', l.district, 'District')}
        ${textField('location.subdistrict', l.subdistrict, 'Sub-district')}
        ${textField('location.village', l.village, 'Village')}
        ${textField('location.altitude', l.altitude, 'Altitude (m)', 'number')}
        <div class="field">
          <label>Coffee Type</label>
          <div class="toggle-group">
            <button type="button" class="chip ${state.coffeeType==='Robusta'?'active':''}" data-field="coffeeType" data-value="Robusta">Robusta</button>
            <button type="button" class="chip ${state.coffeeType==='Arabica'?'active':''}" data-field="coffeeType" data-value="Arabica">Arabica</button>
          </div>
        </div>
      </div>`;
  }

  function stepFarm() {
    const f = state.farm;
    return `<div class="step-body">
      ${textField('farm.farmerName', f.farmerName, 'Farmer Name')}
      ${textField('farm.farmerId', f.farmerId, 'Farmer ID')}
      ${textField('farm.farmAreaHa', f.farmAreaHa, 'Farm Area (ha)', 'number', 'step="0.01"')}
      ${textField('farm.productiveAreaHa', f.productiveAreaHa, 'Productive Coffee Area (ha)', 'number', 'step="0.01"')}
      ${textField('farm.productiveTrees', f.productiveTrees, 'Number of Productive Trees', 'number')}
      ${textField('farm.avgTreeAgeYears', f.avgTreeAgeYears, 'Average Tree Age (years)', 'number', 'step="0.5"')}
      ${selectField('farm.variety', f.variety, 'Coffee Variety', VARIETIES[state.coffeeType])}
      ${selectField('farm.shadeLevel', f.shadeLevel, 'Shade Level', SHADE)}
      ${selectField('farm.irrigation', f.irrigation, 'Irrigation Availability', IRRIGATION)}
    </div>`;
  }

  function stepCropCondition() {
    const c = state.cropCondition;
    const h = state.harvestInfo;
    return `<div class="step-body">
      <div class="section-label">Condition Scores (1 = Poor, 5 = Excellent)</div>
      ${scoreSelector('cropCondition.treeCondition', c.treeCondition, 'Tree Condition')}
      ${scoreSelector('cropCondition.flowering', c.flowering, 'Flowering')}
      ${scoreSelector('cropCondition.fruitSet', c.fruitSet, 'Fruit Set')}
      ${scoreSelector('cropCondition.cherryLoad', c.cherryLoad, 'Cherry Load')}
      ${scoreSelector('cropCondition.beanDevelopment', c.beanDevelopment, 'Bean Development')}
      ${scoreSelector('cropCondition.pestPressure', c.pestPressure, 'Pest Pressure (5=none)')}
      ${scoreSelector('cropCondition.diseasePressure', c.diseasePressure, 'Disease Pressure (5=none)')}
      ${scoreSelector('cropCondition.soilMoisture', c.soilMoisture, 'Soil Moisture')}
      ${scoreSelector('cropCondition.overallCondition', c.overallCondition, 'Overall Crop Condition')}
      <div class="section-label">Flowering & Cherry Stage</div>
      ${textField('harvestInfo.mainFloweringPeriod', h.mainFloweringPeriod, 'Main Flowering Period (e.g. Aug-Sep)')}
      ${textField('harvestInfo.secondaryFlowering', h.secondaryFlowering, 'Secondary Flowering')}
      ${selectField('harvestInfo.currentCherryStage', h.currentCherryStage, 'Current Cherry Stage', CHERRY_STAGES)}
      ${textField('harvestInfo.greenCherryPct', h.greenCherryPct, 'Green Cherry %', 'number')}
      ${textField('harvestInfo.yellowCherryPct', h.yellowCherryPct, 'Yellow/Maturing Cherry %', 'number')}
      ${textField('harvestInfo.redCherryPct', h.redCherryPct, 'Red/Ripe Cherry %', 'number')}
      ${textField('harvestInfo.harvestedPct', h.harvestedPct, 'Already Harvested %', 'number')}
    </div>`;
  }

  function stepSampling() {
    const trees = state.sampling.trees;
    const rows = trees.map((t, i) => `
      <div class="tree-card" data-tree-idx="${i}">
        <div class="tree-card-head">
          <strong>Tree #${t.treeNo}</strong>
          <button type="button" class="btn-icon btn-remove-tree" data-idx="${i}">✕</button>
        </div>
        ${textField(`__tree_${i}.productiveBranches`, t.productiveBranches, 'Productive Branches', 'number')}
        ${textField(`__tree_${i}.cherriesPerBranch`, t.cherriesPerBranch, 'Cherries per Branch (avg)', 'number', 'step="0.1"')}
        <div class="calc-row">Est. Cherries/Tree: <b>${t.estCherriesPerTree ?? '—'}</b> | Est. Green Bean Equiv: <b>${t.estGreenBeanEquivG ?? '—'} g</b></div>
        <div class="field">
          <label>Tree Photo</label>
          <input type="file" accept="image/*" capture="environment" data-tree-photo="${i}"/>
          ${t.photo ? '<span class="photo-tag">📷 Photo attached</span>' : ''}
        </div>
      </div>`).join('');
    return `<div class="step-body">
      <div class="section-label">Representative Tree Samples</div>
      <div id="tree-list">${rows || '<p class="muted">No sample trees yet. Add at least 3 for a reliable estimate.</p>'}</div>
      <button type="button" id="btn-add-tree" class="btn-secondary" style="width:100%;margin-top:8px">+ Add Sample Tree</button>
      <div class="summary-box">
        <div>Avg Cherries/Tree: <b>${state.sampling.avgCherriesPerTree ?? '—'}</b></div>
        <div>Avg Green Bean Equiv: <b>${state.sampling.avgGreenBeanEquivG ?? '—'} g</b></div>
        <div>Estimated Farm Yield: <b>${Utils.fmtKgOrMt(state.sampling.estimatedFarmYieldKg)}</b></div>
      </div>
    </div>`;
  }

  function stepHarvest() {
    const h = state.harvestInfo;
    const ce = state.cropEstimate;
    return `<div class="step-body">
      <div class="section-label">Harvest Timing</div>
      ${textField('harvestInfo.estHarvestStart', h.estHarvestStart, 'Estimated Harvest Start (e.g. Apr 2025)')}
      ${textField('harvestInfo.estPeakHarvest', h.estPeakHarvest, 'Estimated Peak Harvest')}
      ${textField('harvestInfo.estHarvestCompletion', h.estHarvestCompletion, 'Estimated Harvest Completion')}
      <div class="section-label">Crop Estimate</div>
      ${textField('cropEstimate.previousProductionKg', ce.previousProductionKg, 'Previous Crop Production (kg)', 'number')}
      ${textField('cropEstimate.currentEstimateKg', ce.currentEstimateKg, 'Current Crop Estimate (kg)', 'number')}
      ${textField('cropEstimate.expectedSecondCropKg', ce.expectedSecondCropKg, 'Expected Second Crop (kg)', 'number')}
      <div class="calc-box">
        <div>Yield / ha: <b>${ce.expectedYieldPerHaKg ?? '—'} kg</b></div>
        <div>Yield / tree: <b>${ce.expectedYieldPerTreeG ?? '—'} g</b></div>
        <div>Change vs Previous Crop: <b style="color:${Utils.outlookColor(ce.outlook)}">${Utils.fmtPct(ce.changePct)}</b></div>
        <div>Outlook: <b style="color:${Utils.outlookColor(ce.outlook)}">${ce.outlook}</b></div>
      </div>
    </div>`;
  }

  function stepWeather() {
    const w = state.weather;
    return `<div class="step-body">
      ${selectField('weather.rainfallCondition', w.rainfallCondition, 'Rainfall Condition', RAIN_COND)}
      ${selectField('weather.rainfallVsNormal', w.rainfallVsNormal, 'Rainfall vs Normal', RAIN_VS_NORMAL)}
      ${toggleField('weather.drySpell', w.drySpell, 'Dry Spell Observed')}
      ${selectField('weather.temperatureCondition', w.temperatureCondition, 'Temperature Condition', TEMP_COND)}
      ${selectField('weather.waterAvailability', w.waterAvailability, 'Water Availability', WATER_AVAIL)}
      ${selectField('weather.floweringCondition', w.floweringCondition, 'Flowering Condition', FLOWER_COND)}
      ${toggleField('weather.fruitAbortion', w.fruitAbortion, 'Fruit Abortion Observed')}
      ${toggleField('weather.droughtStress', w.droughtStress, 'Drought Stress')}
      ${toggleField('weather.excessiveRainfall', w.excessiveRainfall, 'Excessive Rainfall')}
      ${toggleField('weather.windDamage', w.windDamage, 'Wind Damage')}
      ${textField('weather.pestDiseaseObservations', w.pestDiseaseObservations, 'Pest / Disease Observations')}
      <div class="field">
        <label>Field Agronomist Comments</label>
        <textarea data-field="weather.agronomistComments" rows="4">${w.agronomistComments || ''}</textarea>
      </div>
    </div>`;
  }

  function stepInterview() {
    const i = state.interview;
    return `<div class="step-body">
      ${selectField('interview.expectationVsLastYear', i.expectationVsLastYear, 'Crop Expectation vs Last Year', EXPECT_VS_LAST)}
      ${textField('interview.harvestTiming', i.harvestTiming, 'Harvest Timing')}
      ${textField('interview.farmgatePriceIDR', i.farmgatePriceIDR, 'Current Farmgate Price (IDR/kg)', 'number')}
      ${selectField('interview.sellingIntention', i.sellingIntention, 'Farmer Selling Intention', SELLING_INTENTION)}
      ${textField('interview.pctAlreadySold', i.pctAlreadySold, '% Already Sold', 'number')}
      ${selectField('interview.laborAvailability', i.laborAvailability, 'Labor Availability', LABOR_AVAIL)}
      ${textField('interview.harvestLaborCostIDR', i.harvestLaborCostIDR, 'Harvest Labor Cost (IDR/day)', 'number')}
      ${selectField('interview.fertilizerUsage', i.fertilizerUsage, 'Fertilizer Usage', FERT_USAGE)}
      ${textField('interview.fertilizerCostIDR', i.fertilizerCostIDR, 'Fertilizer Cost (IDR/season)', 'number')}
      ${selectField('interview.majorConcerns', i.majorConcerns, 'Major Production Concerns', CONCERNS)}
    </div>`;
  }

  const PHOTO_CATEGORIES = ['Farm overview', 'Coffee trees', 'Cherries', 'Flowering', 'Pest/disease', 'Farmer/farm reference', 'Other'];

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

  function stepReview() {
    const s = state;
    return `<div class="step-body review-body">
      <h4>Survey Summary</h4>
      <div class="review-grid">
        <div><b>Survey ID</b><span>${s.id}</span></div>
        <div><b>Date</b><span>${s.surveyDate}</span></div>
        <div><b>Surveyor</b><span>${s.surveyor || '—'}</span></div>
        <div><b>Coffee Type</b><span>${s.coffeeType}</span></div>
        <div><b>Location</b><span>${s.location.village || ''}, ${s.location.subdistrict || ''}, ${s.location.district || ''}, ${s.location.province || '—'}</span></div>
        <div><b>GPS</b><span>${s.location.lat ? `${s.location.lat}, ${s.location.lon}` : 'Not captured'}</span></div>
        <div><b>Farmer</b><span>${s.farm.farmerName || '—'} (${s.farm.farmerId || '—'})</span></div>
        <div><b>Farm Area</b><span>${s.farm.farmAreaHa ?? '—'} ha</span></div>
        <div><b>Overall Condition</b><span>${s.cropCondition.overallCondition}/5</span></div>
        <div><b>Harvested</b><span>${s.harvestInfo.harvestedPct ?? 0}%</span></div>
        <div><b>Crop Change</b><span style="color:${Utils.outlookColor(s.cropEstimate.outlook)}">${Utils.fmtPct(s.cropEstimate.changePct)} (${s.cropEstimate.outlook})</span></div>
        <div><b>Sample Trees</b><span>${s.sampling.trees.length}</span></div>
        <div><b>Photos</b><span>${s.photos.length} / ${PHOTO_CATEGORIES.length}</span></div>
      </div>
      <p class="muted">Please review all sections before submitting. You can navigate back to any step to make corrections.</p>
    </div>`;
  }

  function renderStepBody() {
    switch (STEPS[stepIndex]) {
      case 'Location': return stepLocation();
      case 'Farm': return stepFarm();
      case 'Crop Condition': return stepCropCondition();
      case 'Sampling': return stepSampling();
      case 'Harvest': return stepHarvest();
      case 'Weather': return stepWeather();
      case 'Interview': return stepInterview();
      case 'Photos': return stepPhotos();
      case 'Review': return stepReview();
      default: return '';
    }
  }

  function render() {
    calcCropEstimate();
    calcSampling();
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
        if (field.startsWith('__tree_')) {
          const [, idxStr, prop] = field.match(/__tree_(\d+)\.(.+)/);
          state.sampling.trees[+idxStr][prop] = val;
          calcSampling();
          renderKeepStep();
          return;
        }
        setNested(state, field, val);
        if (field.startsWith('cropEstimate.')) calcCropEstimate();
        renderKeepStep();
      });
    });

    Utils.qsa('.score-btn[data-field]', body).forEach(btn => {
      btn.addEventListener('click', () => {
        setNested(state, btn.getAttribute('data-field'), parseInt(btn.getAttribute('data-value')));
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

    const addTreeBtn = Utils.qs('#btn-add-tree', body);
    if (addTreeBtn) addTreeBtn.addEventListener('click', () => {
      state.sampling.trees.push({ treeNo: state.sampling.trees.length + 1, productiveBranches: null, cherriesPerBranch: null, estCherriesPerTree: null, estGreenBeanEquivG: null, photo: null });
      calcSampling();
      renderKeepStep();
    });

    Utils.qsa('.btn-remove-tree', body).forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        state.sampling.trees.splice(idx, 1);
        state.sampling.trees.forEach((t, i) => t.treeNo = i + 1);
        calcSampling();
        renderKeepStep();
      });
    });

    Utils.qsa('input[data-tree-photo]', body).forEach(inp => {
      inp.addEventListener('change', (e) => {
        const idx = parseInt(inp.getAttribute('data-tree-photo'));
        const file = e.target.files[0];
        if (!file) return;
        compressAndStore(file).then(dataUrl => {
          state.sampling.trees[idx].photo = dataUrl;
          renderKeepStep();
        });
      });
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
