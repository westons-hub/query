// Turns a question (the plain object the builder edits) into SQL.
//
// question = {
//   table,                                  main table name
//   join: { table, left, right } | null,    match rows of another table
//   columns: [ref],                         columns to show when not calculating (empty = all)
//   filters: [{ ref, op, value }],
//   groupBy: [{ ref, bucket }],             bucket: 'day' | 'month' | 'year' for dates
//   calc: { fn, ref } | null,               fn: count | sum | avg | min | max
//   sort: { by: 'calc' | ref, dir } | null,
//   limit: number | null,
// }
// ref = { table, column }.  schema = { tableName: { columnName: type } }.

import { parseDate, parseNumber, parseBool } from './types.js';

const RESERVED = new Set(('all and any as asc between by case cast column create cross date default desc distinct else end '
  + 'exists false for from full group having in inner is join left like limit natural not null offset on or order outer '
  + 'primary right select table then time timestamp to true union unique using values when where with year month day').split(' '));

export function ident(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toLowerCase())
    ? name
    : '"' + String(name).replaceAll('"', '""') + '"';
}

export const text = (s) => "'" + String(s).replaceAll("'", "''") + "'";

export const col = (table, column) => ({ table, column });
export const sameRef = (a, b) => Boolean(a && b) && a.table === b.table && a.column === b.column;

export function newQuestion(table) {
  return { table, join: null, columns: [], filters: [], groupBy: [], calc: null, sort: null, limit: null };
}

export const OPS = {
  eq: { label: 'is', sql: '=' },
  ne: { label: 'is not', sql: '<>' },
  gt: { label: 'is more than', sql: '>' },
  gte: { label: 'is at least', sql: '>=' },
  lt: { label: 'is less than', sql: '<' },
  lte: { label: 'is at most', sql: '<=' },
  contains: { label: 'contains', types: ['text'] },
  starts: { label: 'starts with', types: ['text'] },
  blank: { label: 'is blank', noValue: true },
  not_blank: { label: 'is not blank', noValue: true },
};

export function opsFor(type) {
  return Object.keys(OPS).filter((op) => {
    if (OPS[op].types && !OPS[op].types.includes(type)) return false;
    if ((type === 'text' || type === 'bool') && ['gt', 'gte', 'lt', 'lte'].includes(op)) return false;
    return true;
  });
}

export const CALC_ALIAS = { count: 'row_count', sum: 'total', avg: 'average', min: 'smallest', max: 'largest' };
const CALC_SQL = { sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX' };

export function calcAlias(calc) {
  return calc.fn === 'count' ? CALC_ALIAS.count : `${CALC_ALIAS[calc.fn]}_${calc.ref.column}`.replace(/[^A-Za-z0-9_]+/g, '_');
}

export function groupAlias(g) {
  return g.bucket && g.bucket !== 'day' ? `${g.ref.column}_${g.bucket}`.replace(/[^A-Za-z0-9_]+/g, '_') : g.ref.column;
}

const typeOf = (schema, ref) => schema?.[ref.table]?.[ref.column] || 'text';

function literal(type, value) {
  if (type === 'number') {
    const n = typeof value === 'number' ? value : parseNumber(value);
    return n === null ? null : String(n);
  }
  if (type === 'date') {
    const d = parseDate(value);
    return d === null ? null : `DATE ${text(d.slice(0, 10))}`;
  }
  if (type === 'bool') {
    const b = typeof value === 'boolean' ? value : parseBool(value);
    return b === null ? null : b ? 'TRUE' : 'FALSE';
  }
  return String(value ?? '') === '' ? null : text(value);
}

// A filter counts once it has a column and, where one is needed, a usable value.
export function filterReady(f, type) {
  if (!f.ref || !OPS[f.op]) return false;
  if (OPS[f.op].noValue) return true;
  if (f.op === 'contains' || f.op === 'starts') return String(f.value ?? '') !== '';
  return literal(type, f.value) !== null;
}

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (m) => '\\' + m);

export function buildSQL(q, schema = {}) {
  const joined = Boolean(q.join && q.join.table && q.join.left && q.join.right);
  const ref = (r) => (joined ? `${ident(r.table)}.${ident(r.column)}` : ident(r.column));

  const groupExpr = (g) => {
    const name = ref(g.ref);
    if (g.bucket === 'month') return `strftime(${name}, '%Y-%m')`;
    if (g.bucket === 'year') return `year(${name})`;
    return name;
  };

  const grouped = q.groupBy.length > 0;
  const calc = q.calc || (grouped ? { fn: 'count' } : null);

  // SELECT
  const select = [];
  for (const g of q.groupBy) {
    const expr = groupExpr(g);
    const alias = groupAlias(g);
    select.push(g.bucket === 'month' || g.bucket === 'year' ? `${expr} AS ${ident(alias)}` : expr);
  }
  if (calc) {
    const expr = calc.fn === 'count' ? 'COUNT(*)' : `${CALC_SQL[calc.fn]}(${ref(calc.ref)})`;
    select.push(`${expr} AS ${ident(calcAlias(calc))}`);
  } else if (q.columns.length) {
    select.push(...q.columns.map(ref));
  } else {
    select.push('*');
  }

  const lines = [`SELECT ${select.join(', ')}`, `FROM ${ident(q.table)}`];

  // JOIN
  if (joined) {
    const left = { table: q.table, column: q.join.left };
    const right = { table: q.join.table, column: q.join.right };
    const same = typeOf(schema, left) === typeOf(schema, right);
    const side = (r) => (same ? ref(r) : `CAST(${ref(r)} AS VARCHAR)`);
    lines.push(`LEFT JOIN ${ident(q.join.table)} ON ${side(left)} = ${side(right)}`);
  }

  // WHERE
  const where = [];
  for (const f of q.filters) {
    if (!f.ref) continue;
    const name = ref(f.ref);
    const type = typeOf(schema, f.ref);
    if (f.op === 'blank') { where.push(`${name} IS NULL`); continue; }
    if (f.op === 'not_blank') { where.push(`${name} IS NOT NULL`); continue; }
    if (f.op === 'contains' || f.op === 'starts') {
      if (String(f.value ?? '') === '') continue;
      const pattern = (f.op === 'contains' ? '%' : '') + likeEscape(f.value) + '%';
      where.push(`${name} ILIKE ${text(pattern)}${/[\\%_]/.test(f.value) ? " ESCAPE '\\'" : ''}`);
      continue;
    }
    const value = literal(type, f.value);
    if (value === null) continue; // filter still being filled in
    where.push(`${name} ${OPS[f.op].sql} ${value}`);
  }
  if (where.length) lines.push(`WHERE ${where.join('\n  AND ')}`);

  if (grouped) lines.push(`GROUP BY ${q.groupBy.map(groupExpr).join(', ')}`);

  // ORDER BY
  if (q.sort) {
    let target = null;
    if (q.sort.by === 'calc') target = calc ? ident(calcAlias(calc)) : null;
    else {
      const g = q.groupBy.find((x) => sameRef(x.ref, q.sort.by));
      if (g) target = ident(groupAlias(g));
      else if (!calc) target = ref(q.sort.by);
    }
    if (target) lines.push(`ORDER BY ${target}${q.sort.dir === 'desc' ? ' DESC' : ''} NULLS LAST`);
  }

  if (q.limit) lines.push(`LIMIT ${Math.floor(q.limit)}`);
  return lines.join('\n');
}

// Every column a question needs, by table. Used to check whether a saved
// question can run on a different file.
export function requiredColumns(q) {
  const need = new Map();
  const add = (r) => {
    if (!r) return;
    if (!need.has(r.table)) need.set(r.table, new Set());
    need.get(r.table).add(r.column);
  };
  need.set(q.table, new Set());
  q.columns.forEach(add);
  q.filters.forEach((f) => add(f.ref));
  q.groupBy.forEach((g) => add(g.ref));
  if (q.calc?.ref) add(q.calc.ref);
  if (q.sort && q.sort.by !== 'calc') add(q.sort.by);
  if (q.join) {
    add({ table: q.table, column: q.join.left });
    add({ table: q.join.table, column: q.join.right });
  }
  return Object.fromEntries([...need].map(([t, cols]) => [t, [...cols]]));
}
