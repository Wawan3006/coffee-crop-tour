-- 001_postgis_setup.sql -- OPTIONAL PostGIS enablement (Step 11).
--
-- Run this ONLY against a real PostgreSQL server (NOT SQLite -- PostGIS has
-- no SQLite equivalent; the app works fine without it using plain
-- lat/lon columns + haversine math in analytics/validate_gps.py).
--
-- Usage:
--   psql "$DATABASE_URL" -f backend/migrations/001_postgis_setup.sql

CREATE EXTENSION IF NOT EXISTS postgis;

-- Add a geography column to farms for spatial queries (containment,
-- distance, clustering) once PostGIS is available.
ALTER TABLE farms ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);

UPDATE farms
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL;

CREATE INDEX IF NOT EXISTS ix_farms_geom ON farms USING GIST (geom);

-- Example spatial queries enabled once the above is applied:
--
-- Distance between two farms (meters):
--   SELECT ST_Distance(a.geom, b.geom) FROM farms a, farms b WHERE a.id = '...' AND b.id = '...';
--
-- Farms within 500m of each other (possible duplicate coordinate clusters):
--   SELECT a.id, b.id, ST_Distance(a.geom, b.geom) AS meters
--   FROM farms a JOIN farms b ON a.id < b.id
--   WHERE ST_DWithin(a.geom, b.geom, 500);
--
-- Survey density per province (requires a province boundary polygon table,
-- not included here -- would come from an Indonesia admin-boundary shapefile
-- imported separately, e.g. via `shp2pgsql` or `ogr2ogr`):
--   SELECT p.province_name, COUNT(f.id)
--   FROM province_boundaries p
--   JOIN farms f ON ST_Contains(p.geom, f.geom::geometry)
--   GROUP BY p.province_name;
