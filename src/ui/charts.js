// Простые SVG-графики без зависимостей: браузеру нечего устанавливать.

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

export function barChart(container, items, { width = 720, height = 240, unit = '' } = {}) {
  container.innerHTML = '';
  if (!items.length) return;
  const pad = { top: 20, right: 16, bottom: 66, left: 64 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const max = Math.max(1, ...items.map((i) => i.value));
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
  const step = w / items.length;
  const barW = Math.min(64, step * 0.6);
  items.forEach((item, i) => {
    const x = pad.left + step * i + (step - barW) / 2;
    const barH = (item.value / max) * h;
    const rect = el('rect', {
      x,
      y: pad.top + h - barH,
      width: barW,
      height: Math.max(1, barH),
      rx: 4,
      fill: item.color || '#2f6fa8',
    });
    rect.appendChild(el('title', {}, `${item.label}: ${item.value}${unit}`));
    svg.appendChild(rect);
    svg.appendChild(
      el(
        'text',
        { x: x + barW / 2, y: pad.top + h - barH - 5, 'text-anchor': 'middle', 'font-size': 11, fill: '#16202c' },
        String(item.value),
      ),
    );
    svg.appendChild(
      el(
        'text',
        {
          x: x + barW / 2,
          y: pad.top + h + 18,
          'text-anchor': 'end',
          'font-size': 11,
          fill: '#4a5a6a',
          transform: `rotate(-22 ${x + barW / 2} ${pad.top + h + 18})`,
        },
        item.label.length > 12 ? `${item.label.slice(0, 11)}…` : item.label,
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
