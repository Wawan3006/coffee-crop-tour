// ============================================================================
// api.js -- thin fetch() wrapper around the FastAPI backend (Step 6/7).
//
// IMPORTANT (backward compatibility): API_BASE_URL is empty by default. When
// empty, Api.isConfigured() returns false and sync.js/auth.js automatically
// fall back to the original local-only simulation, so the existing GitHub
// Pages deployment keeps working exactly as before with ZERO backend. Once a
// real backend is deployed (Step 4-6), set API_BASE_URL below (or via
// setBaseUrl()) to point the whole app at it.
//
// Persistence: uses LocalStore (js/local-store.js, IndexedDB-backed) instead
// of window.localStorage directly -- see Step "Replace Local Storage".
// ============================================================================

const Api = (() => {
  // Set this to your deployed FastAPI URL, e.g. "https://api.yourcompany.com"
  // Leave as '' to keep the app fully offline-only (original behavior).
  let API_BASE_URL = LocalStore.getItem('cct_api_base_url') || '';

  function isConfigured() {
    return !!API_BASE_URL;
  }

  function setBaseUrl(url) {
    API_BASE_URL = url || '';
    if (API_BASE_URL) LocalStore.setItem('cct_api_base_url', API_BASE_URL);
    else LocalStore.removeItem('cct_api_base_url');
  }

  function getToken() {
    return LocalStore.getItem('cct_api_token') || null;
  }

  function setToken(token) {
    if (token) LocalStore.setItem('cct_api_token', token);
    else LocalStore.removeItem('cct_api_token');
  }

  async function request(path, options = {}) {
    if (!isConfigured()) throw new Error('API_BASE_URL not configured');
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    if (!resp.ok) {
      let detail = resp.statusText;
      try { const body = await resp.json(); detail = body.detail || detail; } catch (e) {}
      throw new Error(`API ${resp.status}: ${detail}`);
    }
    if (resp.status === 204) return null;
    return resp.json();
  }

  async function login(username, password) {
    const data = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(data.access_token);
    return data; // { access_token, user_id, username, full_name, role }
  }

  function logout() {
    setToken(null);
  }

  async function syncBatch(deviceId, surveyorId, surveys) {
    return request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, surveyor_id: surveyorId, surveys }),
    });
  }

  async function getSurveys(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/surveys${qs ? '?' + qs : ''}`);
  }

  async function updateSurvey(surveyId, patch) {
    return request(`/api/surveys/${surveyId}`, { method: 'PUT', body: JSON.stringify(patch) });
  }

  async function getRegions() {
    return request('/api/regions');
  }

  async function healthCheck() {
    return request('/api/health');
  }

  // ---- Analytics / business-calculation endpoints (Step: "Move all
  // business calculations from JavaScript into Python"). All yield
  // estimation, crop scoring, harvest progress, flowering score, weather
  // calculations, validation, duplicate detection, and dashboard/report
  // aggregation math now lives server-side in backend/services/*.py and
  // backend/routers/analytics.py -- this app only calls it. ----

  async function analyticsAggregate(surveys) {
    return request('/api/analytics/aggregate', { method: 'POST', body: JSON.stringify({ surveys }) });
  }

  async function analyticsCompare(surveys, groupBy) {
    return request('/api/analytics/compare', { method: 'POST', body: JSON.stringify({ surveys, group_by: groupBy }) });
  }

  async function analyticsDashboardStats(surveys, majorProvinces) {
    return request('/api/analytics/dashboard-stats', {
      method: 'POST', body: JSON.stringify({ surveys, major_provinces: majorProvinces }),
    });
  }

  async function analyticsForecast(surveys, provinceRef, adjustments) {
    return request('/api/analytics/forecast', {
      method: 'POST', body: JSON.stringify({ surveys, province_ref: provinceRef, adjustments }),
    });
  }

  async function analyticsNarrative(scopeName, surveys) {
    return request('/api/analytics/narrative', {
      method: 'POST', body: JSON.stringify({ scope_name: scopeName, surveys }),
    });
  }

  async function analyticsWeatherScore(params) {
    return request('/api/analytics/weather-score', { method: 'POST', body: JSON.stringify(params) });
  }

  async function analyticsDuplicateCheckFarmer(params) {
    return request('/api/analytics/duplicate-check/farmer', { method: 'POST', body: JSON.stringify(params) });
  }

  async function analyticsDuplicateCheckSurvey(params) {
    return request('/api/analytics/duplicate-check/survey', { method: 'POST', body: JSON.stringify(params) });
  }

  async function analyticsYieldEstimate(params) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined))
    ).toString();
    return request(`/api/analytics/yield-estimate${qs ? '?' + qs : ''}`);
  }

  async function analyticsFloweringScore(floweringCondition) {
    const qs = new URLSearchParams({ flowering_condition: floweringCondition || '' }).toString();
    return request(`/api/analytics/flowering-score?${qs}`);
  }

  async function analyticsCropHealthIndex(params) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined))
    ).toString();
    return request(`/api/analytics/crop-health-index${qs ? '?' + qs : ''}`);
  }

  async function analyticsHarvestProgressStatus(harvestProgressPct) {
    const qs = new URLSearchParams({ harvest_progress_pct: harvestProgressPct }).toString();
    return request(`/api/analytics/harvest-progress-status?${qs}`);
  }

  async function gpsCheck(params) {
    return request('/api/gps/check', { method: 'POST', body: JSON.stringify(params) });
  }

  // Map an app-local survey object (flat QN.xlsx field model, see
  // survey-form.js blankSurvey()) into the backend's SurveyIn schema
  // (schemas.py). Keeps the ENTIRE original record in raw_payload so no
  // questionnaire field is ever lost even before full server-side
  // normalization.
  function toApiSurveyPayload(s) {
    return {
      survey_id: s.id,
      surveyor_name: s.surveyor,
      province: s.province,
      regency: s.district,
      farmer_id: s.farmerId,
      farmer_name: s.farmerName,
      latitude: s.gps && s.gps.lat != null ? s.gps.lat : null,
      longitude: s.gps && s.gps.lon != null ? s.gps.lon : null,
      gps_accuracy: s.gps && s.gps.accuracyM != null ? s.gps.accuracyM : null,
      farm_area_ha: s.totalCoffeeAreaHa != null ? s.totalCoffeeAreaHa : null,
      production_last_year_kg: s.production2025_26 != null ? s.production2025_26 * 100 : null, // Quintal -> kg
      production_current_estimate_kg: s.production2026_27 != null ? s.production2026_27 * 100 : null,
      survey_date: s.surveyDate,
      crop_year: '2026/27',
      sample_no: s.sampleNo,
      local_updated_at: s.updatedAt,
      version_number: 1,
      raw_payload: s,
    };
  }

  return {
    isConfigured, setBaseUrl, getToken, setToken,
    login, logout, syncBatch, getSurveys, updateSurvey, getRegions, healthCheck,
    toApiSurveyPayload,
    analyticsAggregate, analyticsCompare, analyticsDashboardStats, analyticsForecast,
    analyticsNarrative, analyticsWeatherScore, analyticsDuplicateCheckFarmer,
    analyticsDuplicateCheckSurvey, analyticsYieldEstimate, analyticsFloweringScore,
    analyticsCropHealthIndex, analyticsHarvestProgressStatus, gpsCheck,
  };
})();
