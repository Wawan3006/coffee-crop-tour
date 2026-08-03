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

  function outlookClass(pct) {
    if (pct === null || pct === undefined || Number.isNaN(pct)) return 'Similar';
    if (pct >= 15) return 'Strongly Higher';
    if (pct >= 5) return 'Higher';
    if (pct > -5) return 'Similar';
    if (pct > -15) return 'Lower';
    return 'Strongly Lower';
  }

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

  function pctChange(current, previous) {
    if (!previous) return null;
    return (current / previous - 1) * 100;
  }

  // ---- Survey aggregation helpers ----
  function surveyChangePct(s) {
    return s?.cropEstimate?.changePct ?? null;
  }

  function surveyYieldPerHa(s) {
    return s?.cropEstimate?.expectedYieldPerHaKg ?? null;
  }

  function aggregateSurveys(surveys) {
    const totalFarms = surveys.length;
    const totalHa = sum(surveys.map(s => s.farm?.farmAreaHa || 0));
    const provinces = new Set(surveys.map(s => s.location?.province));
    const robusta = surveys.filter(s => s.coffeeType === 'Robusta');
    const arabica = surveys.filter(s => s.coffeeType === 'Arabica');
    const avgOutlookPct = mean(surveys.map(surveyChangePct));
    const avgHarvestPct = mean(surveys.map(s => s.harvestInfo?.harvestedPct ?? null));
    return {
      totalFarms,
      totalLocations: totalFarms,
      totalHa: Math.round(totalHa * 10) / 10,
      provincesCompleted: provinces.size,
      robustaCount: robusta.length,
      arabicaCount: arabica.length,
      robustaHa: Math.round(sum(robusta.map(s => s.farm?.farmAreaHa || 0)) * 10) / 10,
      arabicaHa: Math.round(sum(arabica.map(s => s.farm?.farmAreaHa || 0)) * 10) / 10,
      avgOutlookPct: avgOutlookPct === null ? null : Math.round(avgOutlookPct * 10) / 10,
      avgHarvestPct: avgHarvestPct === null ? null : Math.round(avgHarvestPct * 10) / 10,
    };
  }

  function productionMt(surveys) {
    return sum(surveys.map(s => (s.cropEstimate?.currentEstimateKg || 0))) / 1000;
  }
  function previousProductionMt(surveys) {
    return sum(surveys.map(s => (s.cropEstimate?.previousProductionKg || 0))) / 1000;
  }

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

  // ---- Official QN.xlsx questionnaire template (extracted programmatically
  // from the real QN.xlsx header rows + merged-cell ranges; do not hand-edit) ----
  const QN_TEMPLATE = {"fieldOrder": ["sampleNo", "province", "district", "farmerName", "farmerPhNo", "farmerNote", "farmerUpdateName", "farmerUpdatePhoneNumber", "totalCoffeeAreaHaMar2025", "totalCoffeeAreaHa", "additionalExpandingTreesPerHa", "addBearing2025Ha", "addBearing2025Trees", "addBearing2026Ha", "addBearing2026Trees", "bearingArea2024_25", "bearingArea2025_26", "bearingArea2026_27", "bearingArea2027_28", "production2024_25", "production2025_26", "production2026_27", "production2027_28", "sellingNov25", "sellingDec25", "sellingJan26", "sellingFeb26", "sellingMar26", "sellingApr26", "sellingMay26", "sellingJun26", "sellingJul26", "sellingAug26", "sellingSep26", "sellingOct26", "sellingNov26", "sellingDec26", "sellingUndecided", "actualStock202627Quintal", "stockRegionPct", "flyCropCompareToLY", "flyHarvestNov26", "flyHarvestDec26", "flyHarvestJan27", "flyHarvestFeb27", "flySellNov26", "flySellDec26", "flySellJan27", "flySellFeb27", "mainCropCompareToLY", "mainCropReason", "mainCropStartMonth", "peakHarvestMonth", "rainfallBlossom", "rainfallFruitSet", "devBlossom", "devFruitSet", "damage", "rainsAtOpeningBlossom", "avgPriceSold2025_26", "existingPrice", "expectedPrice", "opinionCurrentPrice", "futurePrice", "reactionHigherPrice", "laborWage2025", "laborWage2026", "herbicideType", "herbicideLitersPerYear", "npk2025", "npk2026", "urea2025", "urea2026", "tsp2025", "tsp2026"], "headerRow1": ["Sample No.", "Province", "District", "Farmers", "", "", "", "", "Total Coffee Area (Ha) Mar 2025", "Total Coffee Area (Ha)", "any additional/expanding tress/Ha", "Additional bearing (area and trees) in 2025", "", "Additional bearing (area and trees) in 2026", "", "Bearing Area (ha)", "", "", "", "Production (Quintals)", "", "", "", "Selling of 2026-27 crop (Quintals)", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "Actual stock 2026-27 coffee at home (Quintal)", "Stock in the region (%)", "Fly crop compare to LY (higher: 1, same: 2, lower: 3)", "Harvesting Fly Crop of 2027-28 crop (Quintals)", "", "", "", "Selling Fly Crop of 2027-28 crop (Quintals)", "", "", "", "Main crop compare to LY (Early:1/Same: 2/Late: 3)", "Reason: 1.  Rains, 2:  Flowering, 3: Dryness", "Main crop start month (3/4/5)", "Peak harvest month (5/6/7/8)", "Rainfall for 2027-28 crop developmental stages (BN/N/AN/Ex)", "", "2027-28 crop development\n(BN/N/AN)", "", "Damage", "Rains at opening blossom (Y/N)", "Price of coffee\n(IDR/Kg)", "", "", "Opinion for current price (Happy:1/Not Happy:2)", "Future Price", "Reaction to recent higher price: 1. Incease grafting. 2. increase fertilizer. 3. better husbandary (others than Fertilizer). 4. Expanding areal 5. improve drying yard. 6. renovate house. 7. buying car/motorcycle. 8. No change.", "Average labor wages (IDR/day)", "", "Application of Herbicides (Glifosat: 1, Paraquat: 2, 3: 2.4 D, Combine: 4, Others: 5)", "Application of Herbicides Per Years per liter", "Application of fertilizers (Quintal)", "", "", "", "", ""], "headerRow2": ["", "", "", "Name", "Ph No.", "Note", "Update Name", "Phone number", "", "", "", "Ha", "Tress", "Ha", "Tress", "2024-25", "2025-26", "2026-27", "2027-28", "2024-25", "2025-26", "2026-27", "2027-28", "Nov-25", "Dec-25", "Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26", "Dec-26", "Undecided", "", "", "", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "", "", "", "", "Blossom", "Fruit set", "Blossom", "Fruit set", "1 - Blossom\n2 - Fruit set\n3 - 1 and 2\n4 - Cherry development\n5 - 2 and 4\n6 - 1 and 4\n7 - All 3 stages\n8 - No damage", "", "Average price they sold 2025-26 coffee", "Existing", "Expected", "", "B - Bullish,\nN - Neutral,\nS - Bearish", "", "2025", "2026", "", "", "NPK - 2025", "NPK - 2026", "Urea- 2025", "Urea- 2026", "TSP-2025", "TSP-2026"], "merges": [[0, 0, 1, 0], [0, 1, 1, 1], [0, 2, 1, 2], [0, 3, 0, 7], [0, 8, 1, 8], [0, 9, 1, 9], [0, 10, 1, 10], [0, 11, 0, 12], [0, 13, 0, 14], [0, 15, 0, 18], [0, 19, 0, 22], [0, 23, 0, 37], [0, 38, 1, 38], [0, 39, 1, 39], [0, 40, 1, 40], [0, 41, 0, 44], [0, 45, 0, 48], [0, 49, 1, 49], [0, 50, 1, 50], [0, 51, 1, 51], [0, 52, 1, 52], [0, 53, 0, 54], [0, 55, 0, 56], [0, 58, 1, 58], [0, 59, 0, 61], [0, 62, 1, 62], [0, 64, 1, 64], [0, 65, 0, 66], [0, 67, 1, 67], [0, 68, 1, 68], [0, 69, 0, 74]]};

  // ---- Export surveys as an .xlsx workbook that reproduces the exact QN.xlsx
  // official questionnaire layout (2-row merged header, same column order),
  // with one data row per survey underneath. Requires SheetJS (window.XLSX),
  // loaded via CDN in index.html. ----
  function surveysToQNRows(surveys) {
    return surveys.map(s => QN_TEMPLATE.fieldOrder.map(key => {
      const v = s[key];
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? 'Y' : 'N';
      return v;
    }));
  }

  function downloadXLSX(surveys, filename = 'crop_tour_questionnaire.xlsx') {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) library not loaded — check index.html <script> tag.');
    }
    const rows = surveysToQNRows(surveys);
    const aoa = [QN_TEMPLATE.headerRow1, QN_TEMPLATE.headerRow2, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = QN_TEMPLATE.merges.map(([r0, c0, r1, c1]) => ({
      s: { r: r0, c: c0 }, e: { r: r1, c: c1 },
    }));
    ws['!cols'] = QN_TEMPLATE.fieldOrder.map(() => ({ wch: 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'QN Questionnaire');
    XLSX.writeFile(wb, filename);
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
    uid, nowIso, fmtNum, fmtPct, fmtKgOrMt, outlookClass, outlookColor, scoreColor,
    mean, sum, groupBy, pctChange, surveyChangePct, surveyYieldPerHa, aggregateSurveys,
    productionMt, previousProductionMt, toCSV, surveysToFlatRows, toGeoJSON, toKML,
    QN_TEMPLATE, surveysToQNRows, downloadXLSX,
    downloadBlob, debounce, el, qs, qsa,
  };
})();
