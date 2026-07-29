"""
Generates seed/demo data for the Coffee Crop Tour PWA.
Produces: coffee_crop_tour/js/data-seed.js  (embedded JS constants, no fetch/CORS issues)
Also prints summary stats for verification.

NOTE: Administrative sub-divisions (district/sub-district/village) and total
planted-area figures are PLACEHOLDER/approximate for demo purposes. In a real
deployment these should be replaced with official BPS/Ditjenbun master data.
"""
import json, random, math
import numpy as np

random.seed(42)
np.random.seed(42)

# ---- Province master data: island, centroid lat/lon, dominant coffee type mix, approx planted area (ha) ----
PROVINCES = [
    # name, island, lat, lon, {Robusta: share_ha, Arabica: share_ha} approx planted area ha
    ("Aceh",            "Sumatra", 4.6951, 96.7494,  {"Robusta": 35000,  "Arabica": 95000}),
    ("North Sumatra",   "Sumatra", 2.1154, 99.5451,  {"Robusta": 40000,  "Arabica": 60000}),
    ("Lampung",         "Sumatra", -4.5585,105.4068, {"Robusta": 155000, "Arabica": 2000}),
    ("South Sumatra",   "Sumatra", -3.3194,103.9144, {"Robusta": 248000, "Arabica": 1500}),
    ("Bengkulu",        "Sumatra", -3.7928,102.2608, {"Robusta": 90000,  "Arabica": 3000}),
    ("Jambi",           "Sumatra", -1.6101,103.6131, {"Robusta": 25000,  "Arabica": 1000}),
    ("West Java",       "Java",    -7.0909,107.6689, {"Robusta": 18000,  "Arabica": 22000}),
    ("Central Java",    "Java",    -7.1510,110.1403, {"Robusta": 15000,  "Arabica": 10000}),
    ("East Java",       "Java",    -7.5360,112.2384, {"Robusta": 30000,  "Arabica": 15000}),
    ("Bali",            "Bali & Nusa Tenggara", -8.3405,115.0920, {"Robusta": 3000, "Arabica": 11000}),
    ("West Nusa Tenggara","Bali & Nusa Tenggara", -8.6529,117.3616, {"Robusta": 4000, "Arabica": 9000}),
    ("East Nusa Tenggara","Bali & Nusa Tenggara", -8.6573,121.0794, {"Robusta": 8000, "Arabica": 42000}),
    ("South Sulawesi",  "Sulawesi", -3.6687,119.9740, {"Robusta": 12000, "Arabica": 73000}),
]

CROP_YEARS = [2023, 2024]

VARIETIES = {
    "Robusta": ["BP 42", "SA 237", "Robusta Lokal", "Tugu Sari", "BP 358"],
    "Arabica": ["Typica", "Kartika", "Sigararutang", "Ateng Super", "Andungsari 2K", "S795"],
}
SHADE = ["None", "Light", "Moderate", "Heavy"]
IRRIGATION = ["None", "Partial", "Full"]
RAIN_COND = ["Below Normal", "Normal", "Above Normal"]
RAIN_VS_NORMAL = ["Much Lower", "Lower", "Normal", "Higher", "Much Higher"]
TEMP_COND = ["Cooler than normal", "Normal", "Warmer than normal"]
WATER_AVAIL = ["Sufficient", "Limited", "Scarce"]
FLOWER_COND = ["Poor", "Fair", "Good", "Excellent"]
CURRENT_CHERRY_STAGE = ["Flowering", "Green Cherry", "Maturing", "Ripe/Red Cherry", "Harvest Ongoing", "Harvest Complete"]
EXPECT_VS_LAST = ["Much Lower", "Lower", "Similar", "Higher", "Much Higher"]
SELLING_INTENTION = ["Sell Immediately", "Hold for Better Price", "Partial Sell/Partial Hold", "Contract Committed"]
LABOR_AVAIL = ["Sufficient", "Tight", "Shortage"]
FERT_USAGE = ["None", "Organic Only", "Chemical Only", "Combined"]
CONCERNS = ["Pest Pressure", "Disease", "Labor Shortage", "Low Farmgate Price", "Fertilizer Cost", "Drought", "Excess Rain", "Aging Trees", "None"]

def outlook_class(pct):
    if pct is None: return "N/A"
    if pct >= 15: return "Strongly Higher"
    if pct >= 5: return "Higher"
    if pct > -5: return "Similar"
    if pct > -15: return "Lower"
    return "Strongly Lower"

def pick_coffee_type(area_dict):
    r, a = area_dict["Robusta"], area_dict["Arabica"]
    return "Robusta" if random.random() < r/(r+a) else "Arabica"

def rand_score(bias=0.0):
    # 1-5 score, biased slightly by province condition factor
    v = np.clip(np.random.normal(3.2+bias, 0.9), 1, 5)
    return int(round(v))

def month_offset(base_month, offset):
    m = base_month + offset
    y = 0
    while m > 12:
        m -= 12; y += 1
    while m < 1:
        m += 12; y -= 1
    return m, y

MONTH_NAMES = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

surveys = []
surveyors = [f"Surveyor {i}" for i in range(1, 19)]
sid_counter = 1

for crop_year in CROP_YEARS:
    for prov_name, island, lat0, lon0, area in PROVINCES:
        # province-level "good/bad season" bias, varies by year for interesting YoY comparisons
        prov_bias = np.random.normal(0, 0.6)
        n_samples = random.randint(9, 14)  # samples per province per crop year
        for i in range(n_samples):
            coffee_type = pick_coffee_type(area)
            district = f"{prov_name} District {random.randint(1,4)}"
            subdistrict = f"Subdistrict {random.choice('ABCDE')}"
            village = f"{prov_name.split()[0]} Village {random.randint(1,30)}"
            lat = lat0 + np.random.uniform(-0.55, 0.55)
            lon = lon0 + np.random.uniform(-0.55, 0.55)
            altitude = int(np.clip(np.random.normal(1250 if coffee_type=="Arabica" else 550, 250), 100, 2000))

            farm_area = round(float(np.clip(np.random.gamma(2.2, 0.9), 0.3, 8)), 2)
            productive_area = round(farm_area * random.uniform(0.7, 0.98), 2)
            trees_per_ha = random.randint(1300, 2000)
            productive_trees = int(productive_area * trees_per_ha)
            avg_tree_age = round(random.uniform(3, 25), 1)
            variety = random.choice(VARIETIES[coffee_type])
            shade = random.choice(SHADE)
            irrigation = random.choice(IRRIGATION)

            cc = dict(
                treeCondition=rand_score(prov_bias), flowering=rand_score(prov_bias),
                fruitSet=rand_score(prov_bias), cherryLoad=rand_score(prov_bias),
                beanDevelopment=rand_score(prov_bias), pestPressure=rand_score(-prov_bias),
                diseasePressure=rand_score(-prov_bias), soilMoisture=rand_score(prov_bias),
            )
            cc["overallCondition"] = int(round(np.mean(list(cc.values()))))

            green_pct = random.randint(5, 45)
            yellow_pct = random.randint(5, 30)
            red_pct = random.randint(5, 35)
            harvested_pct = max(0, 100 - green_pct - yellow_pct - red_pct)

            harvest_start_month = random.choice([4,5,6,7]) if island == "Sumatra" else random.choice([5,6,7,8])
            hs_m, hs_y = month_offset(harvest_start_month, 0)
            hp_m, hp_y = month_offset(harvest_start_month, random.randint(1,2))
            hc_m, hc_y = month_offset(harvest_start_month, random.randint(3,5))

            # crop estimate (kg for this farm)
            base_yield_per_ha = random.uniform(500, 1400) if coffee_type == "Robusta" else random.uniform(350, 1000)
            yield_factor = np.clip(1 + prov_bias*0.12 + np.random.normal(0,0.12), 0.55, 1.6)
            prev_production = round(productive_area * base_yield_per_ha * random.uniform(0.85,1.15), 1)
            current_estimate = round(prev_production * yield_factor, 1)
            second_crop = round(current_estimate * random.uniform(0.05, 0.25), 1)
            change_pct = round((current_estimate/prev_production - 1)*100, 1) if prev_production else None
            outlook = outlook_class(change_pct)
            yield_per_ha = round(current_estimate/productive_area, 1) if productive_area else 0
            yield_per_tree = round((current_estimate*1000)/productive_trees, 1) if productive_trees else 0

            # field sampling (3-6 trees)
            n_trees = random.randint(3,6)
            trees = []
            for t in range(1, n_trees+1):
                branches = random.randint(18, 45)
                cherries_per_branch = round(random.uniform(8, 40),1)
                est_cherries = round(branches*cherries_per_branch,0)
                est_green_bean_g = round(est_cherries*1.7/5.5, 1)  # ~1.7g/cherry, ~5.5:1 cherry:green bean by weight
                trees.append(dict(treeNo=t, productiveBranches=branches, cherriesPerBranch=cherries_per_branch,
                                   estCherriesPerTree=est_cherries, estGreenBeanEquivG=est_green_bean_g, photo=None))
            avg_cherries = round(float(np.mean([t["estCherriesPerTree"] for t in trees])),1)
            avg_green_g = round(float(np.mean([t["estGreenBeanEquivG"] for t in trees])),1)
            est_farm_yield_kg = round(avg_green_g*productive_trees/1000,1)

            weather = dict(
                rainfallCondition=random.choice(RAIN_COND), rainfallVsNormal=random.choice(RAIN_VS_NORMAL),
                drySpell=random.random()<0.25, temperatureCondition=random.choice(TEMP_COND),
                waterAvailability=random.choice(WATER_AVAIL), floweringCondition=random.choice(FLOWER_COND),
                fruitAbortion=random.random()<0.15, droughtStress=random.random()<0.2,
                excessiveRainfall=random.random()<0.18, windDamage=random.random()<0.08,
                pestDiseaseObservations=random.choice(["None observed","Minor leaf rust","Berry borer present","Minor stem borer","Coffee scale minor","Nematode suspected"]),
                agronomistComments=""
            )

            interview = dict(
                expectationVsLastYear=random.choice(EXPECT_VS_LAST),
                harvestTiming=random.choice(["On time","Delayed 2-3 weeks","Earlier than usual"]),
                farmgatePriceIDR=int(random.uniform(9000,32000)) if coffee_type=="Robusta" else int(random.uniform(15000,55000)),
                sellingIntention=random.choice(SELLING_INTENTION),
                pctAlreadySold=random.randint(0,60),
                laborAvailability=random.choice(LABOR_AVAIL),
                harvestLaborCostIDR=int(random.uniform(60000,150000)),
                fertilizerUsage=random.choice(FERT_USAGE),
                fertilizerCostIDR=int(random.uniform(200000,3000000)),
                majorConcerns=random.choice(CONCERNS),
            )

            sample_month = random.randint(1,12)
            survey_date = f"{crop_year}-{sample_month:02d}-{random.randint(1,28):02d}"

            surveys.append(dict(
                id=f"S{crop_year}-{sid_counter:05d}",
                status="synced",
                createdAt=survey_date+"T08:00:00",
                updatedAt=survey_date+"T08:00:00",
                surveyor=random.choice(surveyors),
                cropYear=crop_year,
                surveyDate=survey_date,
                location=dict(lat=round(lat,5), lon=round(lon,5), altitude=altitude, island=island,
                              province=prov_name, district=district, subdistrict=subdistrict, village=village,
                              gpsAccuracyM=round(random.uniform(3,15),1)),
                coffeeType=coffee_type,
                farm=dict(farmerName=f"Farmer {sid_counter:05d}", farmerId=f"F-{sid_counter:06d}",
                          farmAreaHa=farm_area, productiveAreaHa=productive_area, productiveTrees=productive_trees,
                          avgTreeAgeYears=avg_tree_age, variety=variety, shadeLevel=shade, irrigation=irrigation),
                cropCondition=cc,
                harvestInfo=dict(mainFloweringPeriod=f"{MONTH_NAMES[max(1,harvest_start_month-6)]}",
                             secondaryFlowering=f"{MONTH_NAMES[max(1,harvest_start_month-4)]}",
                             currentCherryStage=random.choice(CURRENT_CHERRY_STAGE),
                             greenCherryPct=green_pct, yellowCherryPct=yellow_pct, redCherryPct=red_pct,
                             harvestedPct=harvested_pct,
                             estHarvestStart=f"{MONTH_NAMES[hs_m]} {crop_year+hs_y}",
                             estPeakHarvest=f"{MONTH_NAMES[hp_m]} {crop_year+hp_y}",
                             estHarvestCompletion=f"{MONTH_NAMES[hc_m]} {crop_year+hc_y}"),
                cropEstimate=dict(previousProductionKg=prev_production, currentEstimateKg=current_estimate,
                                   expectedSecondCropKg=second_crop, expectedYieldPerHaKg=yield_per_ha,
                                   expectedYieldPerTreeG=yield_per_tree, changePct=change_pct, outlook=outlook),
                sampling=dict(trees=trees, avgCherriesPerTree=avg_cherries, avgGreenBeanEquivG=avg_green_g,
                              estimatedFarmYieldKg=est_farm_yield_kg),
                weather=weather,
                interview=interview,
                photos=[],
            ))
            sid_counter += 1

print(f"Generated {len(surveys)} seed surveys")

# ---- Province reference table (planted area, island) for production-forecast aggregation ----
province_ref = []
for prov_name, island, lat0, lon0, area in PROVINCES:
    province_ref.append(dict(province=prov_name, island=island, lat=lat0, lon=lon0,
                              plantedAreaHaRobusta=area["Robusta"], plantedAreaHaArabica=area["Arabica"]))

islands = sorted(set(p[1] for p in PROVINCES))
provinces_list = sorted(set(p[0] for p in PROVINCES))

out = {
    "surveys": surveys,
    "provinceRef": province_ref,
    "islands": islands,
    "provinces": provinces_list,
    "cropYears": CROP_YEARS,
    "surveyors": surveyors,
}

js_content = "// AUTO-GENERATED demo/seed dataset for Coffee Crop Tour PWA. Safe to regenerate via tools/gen_seed_data.py\n"
js_content += "const SEED_DATA = " + json.dumps(out) + ";\n"
js_content += "if (typeof module !== 'undefined') { module.exports = SEED_DATA; }\n"

import os
os.makedirs("coffee_crop_tour/js", exist_ok=True)
with open("coffee_crop_tour/js/data-seed.js", "w") as f:
    f.write(js_content)

print("Wrote coffee_crop_tour/js/data-seed.js, size bytes:", os.path.getsize("coffee_crop_tour/js/data-seed.js"))
print("Provinces:", provinces_list)
print("Islands:", islands)
print("Sample record:")
print(json.dumps(surveys[0], indent=2)[:1500])
