// Node-based smoke test for pure-logic parts of the app (no DOM required).
// Loads data-seed.js + utils.js in a vm context and exercises key calculations:
//  - aggregateSurveys, productionMt/previousProductionMt, pctChange, outlookClass
//  - toCSV / toGeoJSON / toKML shape checks
// This does NOT test DOM rendering (app.js/survey-form.js/charts.js/map.js need a
// real browser); those were verified via `node --check` for syntax correctness.
//
// NOTE: data-seed.js intentionally ships with an EMPTY surveys array in
// production (all demo/sample data was cleared per a later task) -- only
// reference/master data (provinces, islands, surveyors, crop years) remains.
// This test is therefore data-size-agnostic: it validates the *shape* and
// *consistency* of the calculation functions rather than asserting a fixed
// record count, so it passes whether surveys.length is 0 or 302.

const fs = require('fs');
const vm = require('vm');

const sandbox = { console, Number, Date, Math, JSON, Array, Object, String, Set };
vm.createContext(sandbox);

const seedSrc = fs.readFileSync('coffee_crop_tour/js/data-seed.js', 'utf8');
const utilsSrc = fs.readFileSync('coffee_crop_tour/js/utils.js', 'utf8');

vm.runInContext(seedSrc, sandbox, { filename: 'data-seed.js' });
vm.runInContext(utilsSrc.replace(/document\.[^\n;]+;?/g, '/* dom-stripped */'), sandbox, { filename: 'utils.js' });

const check = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} - ${label}`); if (!cond) process.exitCode = 1; };

vm.runInContext(`
  // Reference/master data must always be present regardless of survey count.
  var provinces = SEED_DATA.provinces;
  var islands = SEED_DATA.islands;
  var surveyors = SEED_DATA.surveyors;
  var cropYears = SEED_DATA.cropYears;

  var surveys = SEED_DATA.surveys;
  var agg = Utils.aggregateSurveys(surveys);
  var mt = Utils.productionMt(surveys);
  var prevMt = Utils.previousProductionMt(surveys);
  var chg = Utils.pctChange(mt, prevMt);
  var csv = Utils.toCSV(Utils.surveysToFlatRows(surveys.slice(0,5)));
  var geo = Utils.toGeoJSON(surveys.slice(0,5));
  var kml = Utils.toKML(surveys.slice(0,5));
  var outlookSample = Utils.outlookClass(12);
  globalThis.__results = {
    agg, mt, prevMt, chg, csv, geo, kml, outlookSample, n: surveys.length,
    provinces, islands, surveyors, cropYears,
  };
`, sandbox, { filename: 'test.js' });

const r = sandbox.__results;

check('reference data present: provinces non-empty', Array.isArray(r.provinces) && r.provinces.length > 0);
check('reference data present: islands non-empty', Array.isArray(r.islands) && r.islands.length > 0);
check('reference data present: surveyors non-empty', Array.isArray(r.surveyors) && r.surveyors.length > 0);
check('reference data present: cropYears non-empty', Array.isArray(r.cropYears) && r.cropYears.length > 0);

check('aggregateSurveys returns totalFarms == survey count', r.agg.totalFarms === r.n);
check('aggregateSurveys robusta+arabica == totalFarms', (r.agg.robustaCount + r.agg.arabicaCount) === r.agg.totalFarms);
check('productionMt is a number (0 when no surveys, >0 otherwise)', typeof r.mt === 'number' && r.mt >= 0);
check('previousProductionMt is a number (0 when no surveys, >0 otherwise)', typeof r.prevMt === 'number' && r.prevMt >= 0);
check('pctChange returns null when previous production is 0 (division-by-zero guard)',
      r.prevMt === 0 ? r.chg === null : typeof r.chg === 'number');
check('outlookClass(12) == Higher', r.outlookSample === 'Higher');
check('toCSV returns empty string for empty input, or header+rows otherwise',
      r.n === 0 ? r.csv === '' : r.csv.split('\n').length === Math.min(r.n, 5) + 1);
check('toGeoJSON returns a valid FeatureCollection shape for the sampled surveys',
      Array.isArray(r.geo.features) && r.geo.features.length === Math.min(r.n, 5) || (r.n === 0 && r.geo.features.length === 0));
check('toKML returns well-formed KML wrapper regardless of feature count',
      r.kml.startsWith('<?xml') && r.kml.includes('<kml'));

console.log('\nSample aggregate:', JSON.stringify(r.agg, null, 2));
console.log(
  'Indonesia production (survey-based):',
  r.mt.toFixed(1), 'MT vs previous', r.prevMt.toFixed(1),
  'MT, change', r.chg === null ? 'N/A (no prior data)' : r.chg.toFixed(1) + '%'
);
