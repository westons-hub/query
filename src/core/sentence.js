// Describes a question in plain English, e.g. "Total amount by region, biggest first".

import { OPS, sameRef, filterReady } from './sqlgen.js';
import { fmtDate } from './format.js';
import { parseDate } from './types.js';

const CALC_WORDS = { sum: 'Total', avg: 'Average', min: 'Smallest', max: 'Largest' };
const OP_WORDS = { gt: 'is over', gte: 'is at least', lt: 'is under', lte: 'is at most' };

const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export function describe(q, schema = {}) {
  const joined = Boolean(q.join && q.join.table && q.join.left && q.join.right);
  // Say which table a column is from only when both tables have one by that name.
  const name = (ref) => (joined && schema?.[q.table]?.[ref.column] && schema?.[q.join.table]?.[ref.column] ? `${ref.table} ${ref.column}` : ref.column);
  const typeOf = (ref) => schema?.[ref.table]?.[ref.column] || 'text';
  const grouped = q.groupBy.length > 0;
  const calc = q.calc || (grouped ? { fn: 'count' } : null);

  let s;
  if (calc) {
    s = calc.fn === 'count' ? 'Number of rows' : `${CALC_WORDS[calc.fn]} ${name(calc.ref)}`;
    if (grouped) s += ' by ' + list(q.groupBy.map((g) => (g.bucket && g.bucket !== 'day' ? g.bucket : name(g.ref))));
    if (!grouped) s += ` in ${q.table}`;
  } else {
    s = q.columns.length ? `${list(q.columns.map(name))} from ${q.table}` : `All rows in ${q.table}`;
    s = s[0].toUpperCase() + s.slice(1);
  }

  const filters = [];
  for (const f of q.filters) {
    if (!filterReady(f, f.ref ? typeOf(f.ref) : 'text')) continue;
    if (OPS[f.op].noValue) { filters.push(`${name(f.ref)} ${OPS[f.op].label}`); continue; }
    let value = String(f.value);
    if (typeOf(f.ref) === 'date') value = fmtDate(parseDate(value)) || value;
    const word = typeOf(f.ref) === 'date'
      ? { gt: 'is after', gte: 'is on or after', lt: 'is before', lte: 'is on or before' }[f.op] || OPS[f.op].label
      : OP_WORDS[f.op] || OPS[f.op].label;
    filters.push(`${name(f.ref)} ${word} ${value}`);
  }
  if (filters.length) s += ' where ' + filters.join(' and ');

  const top = q.limit && q.sort?.by === 'calc' && calc && q.sort.dir === 'desc';
  if (q.sort) {
    if (q.sort.by === 'calc') {
      if (calc && !top) s += q.sort.dir === 'desc' ? ', biggest first' : ', smallest first';
    } else if (!calc || q.groupBy.some((g) => sameRef(g.ref, q.sort.by))) {
      const type = typeOf(q.sort.by);
      const dir = q.sort.dir === 'desc'
        ? { number: 'highest first', date: 'newest first' }[type] || 'Z to A'
        : { number: 'lowest first', date: 'oldest first' }[type] || 'A to Z';
      // "by month, oldest first" needs no column name; a list of rows does.
      s += calc && q.groupBy.length === 1 ? `, ${dir}` : `, ${name(q.sort.by)} ${dir}`;
    }
  }
  if (top) s += `, top ${q.limit}`;
  else if (q.limit) s += `, first ${q.limit} rows`;
  if (joined) s += ` (${q.table} matched to ${q.join.table})`;
  return s;
}
