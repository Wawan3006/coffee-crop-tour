// ============================================================================
// utils.js — shared helpers: formatting, stats aggregation, geo export, ids
// ============================================================================

const Utils = (() => {

  function uid(prefix = 'ID') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function nowIso() { return new Date().toISOString(); }

  function fmtNum(n, digits = 0) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function fmtPct(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}${Number(n).toFixed(digits)}%`;
  }

  function fmtKgOrMt(kg) {
    if (kg === null || kg === undefined) return '—';
    if (Math.abs(kg) >= 1000) return `${fmtNum(kg / 1000, 1)} MT`;
    return `${fmtNum(kg, 0)} kg`;
  }

  // NOTE: outlookClass() (the business rule that buckets a % change into
  // Strongly Higher/Higher/Similar/Lower/Strongly Lower) has moved to Python
  // -- see backend/services/analytics_service.py::outlook_class() and
  // GET results from Api.analyticsAggregate/analyticsCompare/etc., which
  // already return per-row `changePct`. The frontend only maps the label
  // the server returned to a display color below (pure presentation).

  function outlookColor(label) {
    const map = {
      'Strongly Higher': '#1a7f37',
      'Higher': '#4caf50',
      'Similar': '#9e9e9e',
      'Lower': '#ff9800',
      'Strongly Lower': '#d32f2f',
      'N/A': '#9e9e9e',
    };
    return map[label] || '#9e9e9e';
  }

  function scoreColor(score) {
    // 1 (bad) -> red, 5 (good) -> green
    const colors = ['#d32f2f', '#ff9800', '#ffc107', '#8bc34a', '#1a7f37'];
    return colors[Math.max(0, Math.min(4, Math.round(score) - 1))];
  }

  function mean(arr) {
    const vals = arr.filter(v => typeof v === 'number' && !Number.isNaN(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function sum(arr) {
    return arr.filter(v => typeof v === 'number' && !Number.isNaN(v)).reduce((a, b) => a + b, 0);
  }

  function groupBy(arr, keyFn) {
    const out = {};
    for (const item of arr) {
      const k = keyFn(item);
      (out[k] = out[k] || []).push(item);
    }
    return out;
  }

  // NOTE: All survey aggregation / production math (aggregateSurveys,
  // productionMt, previousProductionMt, pctChange, surveyChangePct,
  // surveyYieldPerHa) has moved to Python -- see
  // backend/services/analytics_service.py and the Api.analytics* wrappers
  // in js/api.js. mean()/sum()/groupBy() below are kept as generic,
  // business-logic-free array helpers (grouping for chart/table iteration
  // order, simple arithmetic) still used for pure display/DOM purposes.

  // ---- CSV / GeoJSON / KML export ----
  function toCSV(rows) {
    if (!rows || !rows.length) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map(h => escape(row[h])).join(','));
    }
    return lines.join('\n');
  }

  function surveysToFlatRows(surveys) {
    return surveys.map(s => ({
      SurveyID: s.id,
      Status: s.status,
      SurveyDate: s.surveyDate,
      Surveyor: s.surveyor,
      CropYear: s.cropYear,
      Province: s.province,
      District: s.district,
      SampleNo: s.sampleNo,
      Lat: s.gps?.lat,
      Lon: s.gps?.lon,
      FarmerId: s.farmerId,
      FarmerName: s.farmerName,
      FarmerPhNo: s.farmerPhNo,
      FarmerNote: s.farmerNote,
      TotalCoffeeAreaHa: s.totalCoffeeAreaHa,
      BearingArea2026_27: s.bearingArea2026_27,
      Production2026_27Quintals: s.production2026_27,
      FlyCropCompareToLY: s.flyCropCompareToLY,
      MainCropCompareToLY: s.mainCropCompareToLY,
      ExistingPriceIDRKg: s.existingPrice,
    }));
  }

  function toGeoJSON(surveys) {
    return {
      type: 'FeatureCollection',
      features: surveys.filter(s => s.gps?.lat && s.gps?.lon).map(s => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.gps.lon, s.gps.lat] },
        properties: {
          id: s.id, status: s.status, province: s.province, district: s.district,
          farmerId: s.farmerId, farmerName: s.farmerName,
          totalCoffeeAreaHa: s.totalCoffeeAreaHa, production2026_27: s.production2026_27,
          flyCropCompareToLY: s.flyCropCompareToLY, surveyDate: s.surveyDate,
        },
      })),
    };
  }

  function toKML(surveys) {
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const placemarks = surveys.filter(s => s.gps?.lat && s.gps?.lon).map(s => `
    <Placemark>
      <name>${esc(s.farmerId || s.id)}</name>
      <description>${esc(s.farmerName)} | Fly Crop vs LY: ${esc(s.flyCropCompareToLY)}</description>
      <Point><coordinates>${s.gps.lon},${s.gps.lat},0</coordinates></Point>
    </Placemark>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemarks}</Document></kml>`;
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  return {
    uid, nowIso, fmtNum, fmtPct, fmtKgOrMt, outlookColor, scoreColor,
    mean, sum, groupBy, toCSV, surveysToFlatRows, toGeoJSON, toKML,
    downloadBlob, debounce, el, qs, qsa,
  };
})();
