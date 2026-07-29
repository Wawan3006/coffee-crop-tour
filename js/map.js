// ============================================================================
// map.js — lightweight offline-capable point map (canvas-based scatter plot,
// no external tile server required so it works with weak/no connectivity).
// Projects lat/lon of Indonesia bounding box onto canvas. Click a point to
// see details in a popup callback.
// ============================================================================

const MapView = (() => {
  // Indonesia approx bounding box
  const BBOX = { minLon: 94.5, maxLon: 141.5, minLat: -11.5, maxLat: 6.5 };

  const MARKER_STYLE = {
    'Robusta_completed': { color: '#6f4e37', shape: 'circle' },
    'Robusta_pending':   { color: '#c9a876', shape: 'ring' },
    'Arabica_completed': { color: '#2e7d32', shape: 'square' },
    'Arabica_pending':   { color: '#a5d6a7', shape: 'ring-square' },
  };

  function project(lat, lon, w, h, pad = 20) {
    const x = pad + ((lon - BBOX.minLon) / (BBOX.maxLon - BBOX.minLon)) * (w - 2 * pad);
    const y = pad + ((BBOX.maxLat - lat) / (BBOX.maxLat - BBOX.minLat)) * (h - 2 * pad);
    return [x, y];
  }

  function unproject(x, y, w, h, pad = 20) {
    const lon = BBOX.minLon + ((x - pad) / (w - 2 * pad)) * (BBOX.maxLon - BBOX.minLon);
    const lat = BBOX.maxLat - ((y - pad) / (h - 2 * pad)) * (BBOX.maxLat - BBOX.minLat);
    return [lat, lon];
  }

  function render(canvas, points, onSelect) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 280);
    const h = Math.max(rect.height, 320);
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // background
    ctx.fillStyle = 'rgba(100,150,220,0.08)';
    ctx.fillRect(0, 0, w, h);

    // simple graticule
    ctx.strokeStyle = 'rgba(120,120,120,0.15)';
    ctx.lineWidth = 1;
    for (let lon = 95; lon <= 140; lon += 5) {
      const [x1, y1] = project(BBOX.maxLat, lon, w, h);
      const [x2, y2] = project(BBOX.minLat, lon, w, h);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    for (let lat = -10; lat <= 6; lat += 4) {
      const [x1, y1] = project(lat, BBOX.minLon, w, h);
      const [x2, y2] = project(lat, BBOX.maxLon, w, h);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    const pixelPoints = [];
    points.forEach(pt => {
      const [x, y] = project(pt.lat, pt.lon, w, h);
      const key = `${pt.coffeeType}_${pt.status === 'synced' ? 'completed' : 'pending'}`;
      const style = MARKER_STYLE[key] || { color: '#999', shape: 'circle' };
      ctx.beginPath();
      ctx.fillStyle = style.color;
      ctx.globalAlpha = pt.status === 'synced' ? 0.9 : 0.55;
      if (style.shape === 'square' ) {
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
      } else if (style.shape === 'ring-square') {
        ctx.strokeStyle = style.color; ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      } else if (style.shape === 'ring') {
        ctx.strokeStyle = style.color; ctx.lineWidth = 1.5;
        ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      pixelPoints.push({ x, y, pt });
    });

    canvas.onclick = (e) => {
      const rect2 = canvas.getBoundingClientRect();
      const cx = e.clientX - rect2.left, cy = e.clientY - rect2.top;
      let best = null, bestD = 14;
      pixelPoints.forEach(p => {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < bestD) { bestD = d; best = p.pt; }
      });
      if (best && onSelect) onSelect(best);
    };

    return { w, h };
  }

  function legendHtml() {
    return `
      <div class="map-legend">
        <span><i style="background:#6f4e37;border-radius:50%"></i> Robusta – Completed</span>
        <span><i style="border:1.5px solid #c9a876;background:transparent;border-radius:50%"></i> Robusta – Pending</span>
        <span><i style="background:#2e7d32"></i> Arabica – Completed</span>
        <span><i style="border:1.5px solid #a5d6a7;background:transparent"></i> Arabica – Pending</span>
      </div>`;
  }

  return { render, legendHtml, project, unproject, BBOX };
})();
