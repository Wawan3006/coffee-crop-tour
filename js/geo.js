// ============================================================================
// geo.js — GPS capture helper (works offline; browser Geolocation API caches
// last known position too so it can return a fix even with no data signal).
// ============================================================================

const Geo = (() => {
  function getPosition(opts = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported on this device/browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: +pos.coords.latitude.toFixed(5),
          lon: +pos.coords.longitude.toFixed(5),
          accuracy: pos.coords.accuracy ? +pos.coords.accuracy.toFixed(1) : null,
          altitude: pos.coords.altitude ? Math.round(pos.coords.altitude) : null,
          ts: Utils.nowIso(),
        }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000, ...opts }
      );
    });
  }

  return { getPosition };
})();
