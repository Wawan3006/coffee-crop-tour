// ============================================================================
// charts.js — lightweight dependency-free canvas charts (bar, donut, line, gauge)
// Designed to work fully offline (no CDN). Theme-aware colors passed by caller.
// ============================================================================

const Charts = (() => {

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 260);
    const h = Math.max(rect.height, 160);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }

  function barChart(canvas, labels, values, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const color = opts.color || '#6f4e37';
    const negColor = opts.negColor || '#d32f2f';
    const padL = 36, padB = 34, padT = 12, padR = 10;
    const chartW = w - padL - padR, chartH = h - padT - padB;
    const maxV = Math.max(1, ...values.map(v => Math.abs(v)));
    const barW = chartW / values.length * 0.62;
    const gap = chartW / values.length;

    ctx.strokeStyle = 'rgba(120,120,120,0.25)';
    ctx.beginPath();
    ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + chartH); ctx.lineTo(padL + chartW, padT + chartH);
    ctx.stroke();

    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';

    values.forEach((v, i) => {
      const x = padL + i * gap + (gap - barW) / 2;
      const barH = (Math.abs(v) / maxV) * (chartH - 4);
      const y = padT + chartH - barH;
      ctx.fillStyle = opts.perBarColor ? opts.perBarColor(v, i) : (v < 0 ? negColor : color);
      ctx.fillRect(x, y, barW, barH);
      ctx.fillStyle = '#555';
      ctx.fillText(String(labels[i]).slice(0, 8), x + barW / 2, padT + chartH + 14);
      ctx.fillStyle = '#333';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(opts.fmt ? opts.fmt(v) : Math.round(v), x + barW / 2, y - 4);
      ctx.font = '10px sans-serif';
    });
  }

  function lineChart(canvas, labels, series, opts = {}) {
    // series: [{name, values:[], color}]
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const padL = 36, padB = 26, padT = 14, padR = 10;
    const chartW = w - padL - padR, chartH = h - padT - padB;
    const allVals = series.flatMap(s => s.values);
    const maxV = Math.max(1, ...allVals);
    const minV = Math.min(0, ...allVals);
    const range = (maxV - minV) || 1;

    ctx.strokeStyle = 'rgba(120,120,120,0.25)';
    ctx.beginPath();
    ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + chartH); ctx.lineTo(padL + chartW, padT + chartH);
    ctx.stroke();

    const n = labels.length;
    series.forEach(s => {
      ctx.strokeStyle = s.color || '#6f4e37';
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const x = padL + (n <= 1 ? 0 : (i / (n - 1)) * chartW);
        const y = padT + chartH - ((v - minV) / range) * chartH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = s.color || '#6f4e37';
      s.values.forEach((v, i) => {
        const x = padL + (n <= 1 ? 0 : (i / (n - 1)) * chartW);
        const y = padT + chartH - ((v - minV) / range) * chartH;
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      });
    });

    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';
    labels.forEach((l, i) => {
      const x = padL + (n <= 1 ? 0 : (i / (n - 1)) * chartW);
      ctx.fillText(String(l), x, padT + chartH + 14);
    });
  }

  function donutChart(canvas, segments, opts = {}) {
    // segments: [{label, value, color}]
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 6;
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    let start = -Math.PI / 2;
    segments.forEach(seg => {
      const angle = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      start += angle;
    });
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (opts.centerText) {
      ctx.fillStyle = opts.centerColor || '#333';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.centerText, cx, cy - 6);
      if (opts.centerSubText) {
        ctx.font = '10px sans-serif';
        ctx.fillText(opts.centerSubText, cx, cy + 10);
      }
    }
  }

  function gauge(canvas, pct, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h - 10;
    const r = Math.min(w / 2, h) - 12;
    const startAngle = Math.PI, endAngle = 0;
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(120,120,120,0.2)';
    ctx.beginPath(); ctx.arc(cx, cy, r, startAngle, endAngle, true); ctx.stroke();
    const p = Math.max(0, Math.min(100, pct)) / 100;
    ctx.strokeStyle = opts.color || '#4caf50';
    ctx.beginPath(); ctx.arc(cx, cy, r, startAngle, startAngle - p * Math.PI, true); ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(pct)}%`, cx, cy - 14);
  }

  return { barChart, lineChart, donutChart, gauge };
})();
