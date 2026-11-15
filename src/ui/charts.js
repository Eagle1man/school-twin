// Простые SVG-графики без зависимостей: браузеру нечего устанавливать.

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

// Горизонтальные полосы: длинные подписи вариантов читаются целиком,
// а не обрезаются на «Только пере…».
export function barChart(container, items, { width = 720, unit = '' } = {}) {
  container.innerHTML = '';
  if (!items.length) return;
  const rowH = 34;
  const barH = 20;
  const pad = { top: 8, right: 64, bottom: 8, left: 210 };
  const height = items.length * rowH + pad.top + pad.bottom;
  const w = width - pad.left - pad.right;
  const max = Math.max(1, ...items.map((i) => i.value));
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' });

  items.forEach((item, i) => {
    const y = pad.top + i * rowH;
    const barW = Math.max(item.value > 0 ? 2 : 0, (item.value / max) * w);
    svg.appendChild(
      el(
        'text',
        { x: pad.left - 10, y: y + barH - 4, 'text-anchor': 'end', 'font-size': 11.5, fill: '#16202c' },
        item.label,
      ),
    );
    const rect = el('rect', {
      x: pad.left,
      y,
      width: barW,
      height: barH,
      rx: 4,
      fill: item.color || '#2f6fa8',
    });
    rect.appendChild(el('title', {}, `${item.label}: ${item.value}${unit}`));
    svg.appendChild(rect);
    svg.appendChild(
      el(
        'text',
        { x: pad.left + barW + 8, y: y + barH - 4, 'font-size': 11.5, fill: '#4a5a6a' },
        `${item.value}${unit}`,
      ),
    );
  });
  container.appendChild(svg);
}

export function lineChart(container, series, { width = 720, height = 260, xLabels = [], unit = '' } = {}) {
  container.innerHTML = '';
  if (!series.length || !series[0].values.length) return;
  const pad = { top: 20, right: 160, bottom: 40, left: 48 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = series[0].values.length;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' });
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h * i) / 4;
    svg.appendChild(el('line', { x1: pad.left, x2: pad.left + w, y1: y, y2: y, stroke: '#e6ecf3' }));
    svg.appendChild(
      el(
        'text',
        { x: pad.left - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#7b8794' },
        String(Math.round(max - (max * i) / 4)),
      ),
    );
  }
  const colors = ['#1f4e79', '#0f766e', '#b45309', '#7c3aed', '#b42318', '#475569'];
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => {
      const x = pad.left + (n === 1 ? w / 2 : (w * i) / (n - 1));
      const y = pad.top + h - (v / max) * h;
      return [x, y];
    });
    svg.appendChild(
      el('polyline', {
        points: pts.map((p) => p.join(',')).join(' '),
        fill: 'none',
        stroke: colors[si % colors.length],
        'stroke-width': 2,
      }),
    );
    pts.forEach(([x, y], i) => {
      const circle = el('circle', { cx: x, cy: y, r: 3.5, fill: colors[si % colors.length] });
      circle.appendChild(el('title', {}, `${s.label}, ${xLabels[i]}: ${s.values[i]}${unit}`));
      svg.appendChild(circle);
    });
    const labelNode = el(
      'text',
      { x: pad.left + w + 10, y: pad.top + 10 + si * 16, 'font-size': 11, fill: colors[si % colors.length] },
      s.label.length > 22 ? `${s.label.slice(0, 21)}…` : s.label,
    );
    labelNode.appendChild(el('title', {}, s.label));
    svg.appendChild(labelNode);
  });
  xLabels.forEach((label, i) => {
    const x = pad.left + (n === 1 ? w / 2 : (w * i) / (n - 1));
    svg.appendChild(
      el('text', { x, y: pad.top + h + 18, 'text-anchor': 'middle', 'font-size': 11, fill: '#4a5a6a' }, label),
    );
  });
  container.appendChild(svg);
}
