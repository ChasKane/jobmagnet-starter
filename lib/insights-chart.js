/** SVG charts for the insights dashboard. Series values stay in the title tooltips. */

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatValue(kind, value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  if (kind === 'ratio') return `${Math.round(Number(value) * 1000) / 10}%`;
  if (kind === 'mean') {
    const rounded = Math.round(Number(value) * 10) / 10;
    return String(rounded);
  }
  return String(Math.round(Number(value)));
}

function axisLabel(tick, grain) {
  if (grain === 'month') return tick;
  return tick.slice(5);
}

function renderChart({ title, axis, series, bands, grain }) {
  const ticks = Array.isArray(axis) ? axis : [];
  const rows = Array.isArray(series) ? series : [];
  if (!ticks.length || !rows.length) return '';

  const width = 760;
  const height = 228;
  const pad = { l: 36, r: 12, t: 22, b: 28 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const slot = plotW / ticks.length;
  const counts = rows.filter((row) => row.kind === 'count');
  const lines = rows.filter((row) => row.kind !== 'count');
  const countMax = Math.max(
    1,
    ...counts.flatMap((row) => (row.points || []).map((point) => Number(point.value) || 0))
  );
  const lineMax = new Map();
  for (const row of lines) {
    const peak = Math.max(0, ...(row.points || []).map((point) => (point.value == null ? 0 : Number(point.value))));
    lineMax.set(row.key, peak || 1);
  }

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title || 'Chart')}" class="chart-svg">`
  );

  for (const band of bands || []) {
    if (band.startIndex < 0 || band.endIndex < band.startIndex) continue;
    const x = pad.l + band.startIndex * slot;
    const w = (band.endIndex - band.startIndex + 1) * slot;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${pad.t}" width="${w.toFixed(1)}" height="${plotH}" fill="${esc(band.color)}" opacity="0.14"><title>${esc(band.name)}</title></rect>`
    );
    if (w >= 36) {
      parts.push(
        `<text x="${(x + 4).toFixed(1)}" y="${pad.t + 11}" fill="${esc(band.color)}" font-size="10" font-family="IBM Plex Sans, Segoe UI, sans-serif">${esc(band.name)}</text>`
      );
    }
  }

  const yTicks = [0, countMax / 2, countMax];
  for (const tick of yTicks) {
    const y = pad.t + plotH - (tick / countMax) * plotH;
    parts.push(
      `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${width - pad.r}" y2="${y.toFixed(1)}" stroke="#2e3445" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${pad.l - 6}" y="${(y + 3).toFixed(1)}" fill="#8b93a7" font-size="10" text-anchor="end" font-family="IBM Plex Sans, Segoe UI, sans-serif">${esc(formatValue('count', tick))}</text>`
    );
  }

  const barW = counts.length ? Math.max(2, Math.min(14, (slot * 0.72) / counts.length)) : 0;
  const groupW = barW * counts.length;
  ticks.forEach((tick, index) => {
    const cx = pad.l + index * slot + slot / 2;
    counts.forEach((row, seriesIndex) => {
      const point = (row.points || [])[index];
      const value = point && point.value != null ? Number(point.value) : 0;
      const h = (value / countMax) * plotH;
      const x = cx - groupW / 2 + seriesIndex * barW;
      const y = pad.t + plotH - h;
      if (h <= 0) return;
      parts.push(
        `<rect data-series="${esc(row.key)}" data-t="${esc(tick)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${esc(row.color)}" rx="1"><title>${esc(tick)} · ${esc(row.label)} ${esc(formatValue(row.kind, value))}</title></rect>`
      );
    });
    const step = Math.ceil(ticks.length / 8);
    if (index % step === 0) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${height - 8}" fill="#8b93a7" font-size="10" text-anchor="middle" font-family="IBM Plex Sans, Segoe UI, sans-serif">${esc(axisLabel(tick, grain))}</text>`
      );
    }
  });

  for (const row of lines) {
    const peak = lineMax.get(row.key) || 1;
    const coords = [];
    ticks.forEach((tick, index) => {
      const point = (row.points || [])[index];
      if (!point || point.value == null) return;
      const x = pad.l + index * slot + slot / 2;
      const y = pad.t + plotH - (Number(point.value) / peak) * plotH;
      coords.push([x, y, tick, point.value]);
    });
    if (!coords.length) continue;
    const d = coords.map((pair, index) => `${index ? 'L' : 'M'}${pair[0].toFixed(1)} ${pair[1].toFixed(1)}`).join(' ');
    parts.push(`<path data-series="${esc(row.key)}" d="${d}" fill="none" stroke="${esc(row.color)}" stroke-width="2" stroke-linejoin="round"/>`);
    for (const [x, y, tick, value] of coords) {
      parts.push(
        `<circle data-series="${esc(row.key)}" data-t="${esc(tick)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${esc(row.color)}"><title>${esc(tick)} · ${esc(row.label)} ${esc(formatValue(row.kind, value))}</title></circle>`
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

module.exports = { renderChart, formatValue };
