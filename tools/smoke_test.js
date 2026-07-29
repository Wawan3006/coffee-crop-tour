// Node-based smoke test for pure-logic parts of the app (no DOM required).
// Loads data-seed.js + utils.js in a vm context and exercises key calculations:
//  - aggregateSurveys, productionMt/previousProductionMt, pctChange, outlookClass
//  - toCSV / toGeoJSON / toKML shape checks
// This does NOT test DOM rendering (app.js/survey-form.js/charts.js/map.js need a
// real browser); those were verified via `node --check` for syntax correctness.

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
  var surveys = SEED_DATA.surveys;
  var agg = Utils.aggregateSurveys(surveys);
  var mt = Utils.productionMt(surveys);
  var prevMt = Utils.previousProductionMt(surveys);
  var chg = Utils.pctChange(mt, prevMt);
  var csv = Utils.toCSV(Utils.surveysToFlatRows(surveys.slice(0,5)));
  var geo = Utils.toGeoJSON(surveys.slice(0,5));
  var kml = Utils.toKML(surveys.slice(0,5));
  var outlookSample = Utils.outlookClass(12);
  globalThis.__results = { agg, mt, prevMt, chg, csv, geo, kml, outlookSample, n: surveys.length };
`, sandbox, { filename: 'test.js' });

const r = sandbox.__results;
check('surveys loaded (302 expected)', r.n === 302);
check('aggregateSurveys returns totalFarms == n', r.agg.totalFarms === r.n);
check('aggregateSurveys robusta+arabica == totalFarms', (r.agg.robustaCount + r.agg.arabicaCount) === r.agg.totalFarms);
check('productionMt is positive number', typeof r.mt === 'number' && r.mt > 0);
check('previousProductionMt is positive number', typeof r.prevMt === 'number' && r.prevMt > 0);
check('pctChange computed as number', typeof r.chg === 'number');
check('outlookClass(12) == Higher', r.outlookSample === 'Higher');
check('CSV has header + 5 data rows', r.csv.split('\n').length === 6);
check('GeoJSON has 5 features', r.geo.features.length === 5);
check('KML contains Placemark tags', (r.kml.match(/<Placemark>/g) || []).length === 5);

console.log('\nSample aggregate:', JSON.stringify(r.agg, null, 2));
console.log('Indonesia production (survey-based):', r.mt.toFixed(1), 'MT vs previous', r.prevMt.toFixed(1), 'MT, change', r.chg.toFixed(1), '%');
