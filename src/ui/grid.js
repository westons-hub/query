// A table that only draws the rows on screen, so 100,000+ rows scroll smoothly.
// Data is held by column: data.columns[c].values[r].

import { h } from './dom.js';
import { fmtValue } from '../core/format.js';

const ROW = 30;
const MAX_HEIGHT = 8_000_000; // browsers cap element heights; beyond this we scale the scrollbar

function columnWidth(col, order) {
  let chars = col.name.length + 3;
  const step = Math.max(1, Math.floor(order.length / 200));
  for (let i = 0; i < order.length; i += step) {
    const len = fmtValue(col.values[order[i]], col.type, col.unit).length;
    if (len > chars) chars = len;
  }
  return Math.min(Math.max(chars * 8 + 24, 72), 320);
}

export function sortOrder(values, type, dir) {
  const order = Uint32Array.from({ length: values.length }, (_, i) => i);
  const sign = dir === 'desc' ? -1 : 1;
  const cmp = type === 'text'
    ? (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
    : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  order.sort((i, j) => {
    const a = values[i];
    const b = values[j];
    if (a == null || b == null) return a == null ? (b == null ? i - j : 1) : -1; // blanks last
    return sign * cmp(a, b) || i - j;
  });
  return order;
}

export function createGrid(container) {
  const head = h('div', { class: 'grid-head', role: 'row' });
  const body = h('div', { class: 'grid-body' });
  const spacer = h('div', { class: 'grid-spacer' }, body);
  const scroller = h('div', { class: 'grid-scroll', tabindex: '0', role: 'table', 'aria-label': 'Result rows' }, head, spacer);
  container.replaceChildren(scroller);

  let data = { columns: [], rowCount: 0 };
  let order = new Uint32Array(0);
  let sort = null;
  let template = '';
  let scale = 1;

  function draw() {
    const viewH = scroller.clientHeight || 400;
    const top = scroller.scrollTop * scale;
    const first = Math.max(0, Math.floor(top / ROW) - 5);
    const last = Math.min(data.rowCount, Math.ceil((top + viewH) / ROW) + 5);
    const rows = [];
    for (let r = first; r < last; r++) {
      const src = order[r];
      const cells = data.columns.map((col) => {
        const v = col.values[src];
        return h('div', { class: `cell ${col.type === 'number' ? 'num' : ''} ${v == null ? 'blank' : ''}`, role: 'cell', text: fmtValue(v, col.type, col.unit) });
      });
      rows.push(h('div', { class: 'grid-row', role: 'row', 'aria-rowindex': r + 2, style: { gridTemplateColumns: template } }, cells));
    }
    body.style.transform = `translateY(${first * ROW / scale}px)`;
    body.replaceChildren(...rows);
  }

  function drawHead() {
    head.style.gridTemplateColumns = template;
    head.replaceChildren(...data.columns.map((col, c) => {
      const active = sort && sort.c === c;
      return h('button', {
        class: `cell head ${col.type === 'number' ? 'num' : ''}`,
        role: 'columnheader',
        type: 'button',
        title: `Sort by ${col.name}`,
        'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
        onclick: () => {
          sort = { c, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' };
          order = sortOrder(col.values, col.type, sort.dir);
          drawHead();
          draw();
        },
      }, col.name, h('span', { class: 'sort-mark', 'aria-hidden': 'true', text: active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '' }));
    }));
  }

  let frame = 0;
  scroller.addEventListener('scroll', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  new ResizeObserver(() => draw()).observe(scroller);

  return {
    set(next) {
      data = next;
      sort = null;
      order = Uint32Array.from({ length: data.rowCount }, (_, i) => i);
      const widths = data.columns.map((col) => columnWidth(col, order));
      template = widths.map((w) => `${w}px`).join(' ');
      const full = data.rowCount * ROW;
      scale = full > MAX_HEIGHT ? full / MAX_HEIGHT : 1;
      spacer.style.height = `${full / scale}px`;
      spacer.style.minWidth = `${widths.reduce((a, b) => a + b, 0)}px`;
      scroller.setAttribute('aria-rowcount', data.rowCount + 1);
      scroller.scrollTop = 0;
      drawHead();
      draw();
    },
    // Rows in the order currently shown, for export.
    order: () => order,
  };
}
