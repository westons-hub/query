// Answers a builder question directly in JavaScript, without the SQL engine.
// Used for an instant first result while DuckDB is still downloading. It
// covers single-table questions; anything with a join waits for the engine.

import { OPS, calcAlias, groupAlias, sameRef } from './sqlgen.js';
import { parseDate, parseNumber, parseBool } from './types.js';

export const canRunLocally = (q) => !(q.join && q.join.table && q.join.left && q.join.right);

function compare(a, b) {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1; // blanks last
  return a < b ? -1 : a > b ? 1 : 0;
}

function filterTest(f, type) {
  if (f.op === 'blank') return (v) => v == null;
  if (f.op === 'not_blank') return (v) => v != null;
  if (f.op === 'contains' || f.op === 'starts') {
    const needle = String(f.value ?? '').toLowerCase();
    if (!needle) return null;
    return f.op === 'contains'
      ? (v) => v != null && String(v).toLowerCase().includes(needle)
      : (v) => v != null && String(v).toLowerCase().startsWith(needle);
  }
  let target;
  if (type === 'number') target = typeof f.value === 'number' ? f.value : parseNumber(f.value);
  else if (type === 'date') target = parseDate(f.value)?.slice(0, 10) ?? null;
  else if (type === 'bool') target = typeof f.value === 'boolean' ? f.value : parseBool(f.value);
  else target = String(f.value ?? '') === '' ? null : String(f.value);
  if (target == null) return null;
  const norm = type === 'date' ? (v) => v.slice(0, 10) : (v) => v;
  const tests = {
    eq: (v) => v != null && norm(v) === target,
    ne: (v) => v != null && norm(v) !== target,
    gt: (v) => v != null && norm(v) > target,
    gte: (v) => v != null && norm(v) >= target,
    lt: (v) => v != null && norm(v) < target,
    lte: (v) => v != null && norm(v) <= target,
  };
  return tests[f.op] || null;
}

// view is the result of viewOf(table). Returns { columns: [{ name, type, unit, values }], rowCount }.
export function runLocally(q, view) {
  const index = (ref) => view.headers.indexOf(ref.column);
  const typeAt = (ref) => view.types[index(ref)];
  const n = view.profile.rowCount;

  let rows = [];
  const tests = q.filters
    .filter((f) => f.ref && OPS[f.op])
    .map((f) => ({ values: view.columns[index(f.ref)], test: filterTest(f, typeAt(f.ref).type) }))
    .filter((t) => t.test);
  for (let r = 0; r < n; r++) if (tests.every((t) => t.test(t.values[r]))) rows.push(r);

  const grouped = q.groupBy.length > 0;
  const calc = q.calc || (grouped ? { fn: 'count' } : null);
  let columns;

  if (!calc) {
    const refs = q.columns.length ? q.columns : view.headers.map((column) => ({ table: q.table, column }));
    if (q.sort && q.sort.by !== 'calc') {
      const values = view.columns[index(q.sort.by)];
      const sign = q.sort.dir === 'desc' ? -1 : 1;
      rows.sort((a, b) => (values[a] == null || values[b] == null ? compare(values[a], values[b]) : sign * compare(values[a], values[b])) || a - b);
    }
    if (q.limit) rows = rows.slice(0, q.limit);
    columns = refs.map((ref) => {
      const info = typeAt(ref);
      const source = view.columns[index(ref)];
      return { name: ref.column, type: info.type, unit: info.unit, values: rows.map((r) => source[r]) };
    });
    return { columns, rowCount: rows.length };
  }

  const keyOf = q.groupBy.map((g) => {
    const values = view.columns[index(g.ref)];
    if (g.bucket === 'month') return (r) => (values[r] == null ? null : values[r].slice(0, 7));
    if (g.bucket === 'year') return (r) => (values[r] == null ? null : Number(values[r].slice(0, 4)));
    return (r) => values[r];
  });
  const measure = calc.fn === 'count' ? null : view.columns[index(calc.ref)];
  const groups = new Map();
  for (const r of rows) {
    const keys = keyOf.map((fn) => fn(r));
    const id = keys.map((k) => `${typeof k}:${k}`).join('\u0001');
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { keys, count: 0, filled: 0, sum: 0, min: null, max: null }));
    g.count++;
    const v = measure ? measure[r] : null;
    if (v != null) {
      g.filled++;
      if (typeof v === 'number') g.sum += v;
      if (g.min === null || v < g.min) g.min = v;
      if (g.max === null || v > g.max) g.max = v;
    }
  }
  if (!grouped && !groups.size) groups.set('', { keys: [], count: 0, filled: 0, sum: 0, min: null, max: null });
  const value = (g) => ({
    count: g.count,
    sum: g.filled ? g.sum : null,
    avg: g.filled ? g.sum / g.filled : null,
    min: g.min,
    max: g.max,
  })[calc.fn];

  let out = [...groups.values()].map((g) => [...g.keys, value(g)]);
  if (q.sort) {
    const at = q.sort.by === 'calc' ? q.groupBy.length : q.groupBy.findIndex((g) => sameRef(g.ref, q.sort.by));
    if (at !== -1) {
      const sign = q.sort.dir === 'desc' ? -1 : 1;
      out.sort((a, b) => (a[at] == null || b[at] == null ? compare(a[at], b[at]) : sign * compare(a[at], b[at])));
    }
  }
  if (q.limit) out = out.slice(0, q.limit);

  columns = q.groupBy.map((g, i) => {
    const info = typeAt(g.ref);
    const type = g.bucket === 'month' ? 'text' : g.bucket === 'year' ? 'number' : info.type;
    return { name: groupAlias(g), type, unit: g.bucket === 'year' ? 'id' : g.bucket ? '' : info.unit, values: out.map((row) => row[i]) };
  });
  const measureInfo = calc.fn === 'count' ? { type: 'number' } : typeAt(calc.ref);
  columns.push({
    name: calcAlias(calc),
    type: calc.fn === 'min' || calc.fn === 'max' ? measureInfo.type : 'number',
    unit: calc.fn === 'count' ? '' : measureInfo.unit,
    values: out.map((row) => row[q.groupBy.length]),
  });
  return { columns, rowCount: out.length };
}
