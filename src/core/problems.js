// Finds common problems in a table and, for each one, the cleanup step that
// fixes it plus a few before/after examples to preview.

import { isBlank, convert } from './types.js';

const EXAMPLES = 5;
const plural = (n, one, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function blankRows(headers, rows) {
  const hits = [];
  rows.forEach((row, i) => { if (row.every(isBlank)) hits.push(i); });
  if (!hits.length) return null;
  return {
    kind: 'blank_rows',
    title: plural(hits.length, 'blank row'),
    detail: 'Rows with nothing in them. They add to row counts without adding data.',
    fixLabel: 'Remove blank rows',
    count: hits.length,
    examples: hits.slice(0, EXAMPLES).map((i) => ({ before: `Row ${i + 1} (empty)`, after: 'removed' })),
    step: { op: 'remove_blank_rows' },
  };
}

function duplicateRows(headers, rows) {
  const first = new Map();
  const hits = [];
  rows.forEach((row, i) => {
    if (row.every(isBlank)) return;
    const key = row.map((c) => String(c).trim()).join('\u0001');
    if (first.has(key)) hits.push({ i, of: first.get(key) }); else first.set(key, i);
  });
  if (!hits.length) return null;
  return {
    kind: 'duplicate_rows',
    title: plural(hits.length, 'duplicate row'),
    detail: 'Rows that repeat an earlier row exactly. The first copy is kept.',
    fixLabel: 'Remove duplicates',
    count: hits.length,
    examples: hits.slice(0, EXAMPLES).map(({ i, of }) => ({
      before: `Row ${i + 1}: ${rows[i].filter((c) => !isBlank(c)).slice(0, 4).join(' · ')}`,
      after: `removed (same as row ${of + 1})`,
    })),
    step: { op: 'remove_duplicates' },
  };
}

const TOTAL_WORD = /^(grand\s+|sub-?)?totals?\b|^sum\b/i;

function totalsRow(headers, rows, types) {
  let last = rows.length - 1;
  while (last >= 0 && rows[last].every(isBlank)) last--;
  if (last < 3) return null;
  const row = rows[last];
  let labelled = row.some((c) => TOTAL_WORD.test(String(c).trim()));

  if (!labelled) {
    // No "Total" label: look for numbers that equal the sum of everything above
    // in a row that leaves other columns empty.
    let sums = 0;
    let numeric = 0;
    types.forEach((info, c) => {
      if (info.type !== 'number') return;
      const value = convert(row[c], info);
      if (value === null) return;
      numeric++;
      let total = 0;
      for (let i = 0; i < last; i++) total += convert(rows[i][c], info) ?? 0;
      if (total !== 0 && Math.abs(total - value) <= Math.max(0.01, Math.abs(total) * 1e-6)) sums++;
    });
    labelled = numeric > 0 && sums === numeric && row.some(isBlank);
  }
  if (!labelled) return null;
  return {
    kind: 'totals_row',
    title: 'Totals row at the bottom',
    detail: 'The last row adds up the rows above it. Left in, every sum would be counted twice.',
    fixLabel: 'Remove totals row',
    count: 1,
    examples: [{ before: `Row ${last + 1}: ${row.filter((c) => !isBlank(c)).join(' · ')}`, after: 'removed' }],
    step: { op: 'remove_rows', rows: [last] },
  };
}

const TYPE_NOUN = { number: 'a number', date: 'a date', bool: 'yes/no' };

function typeMismatches(headers, rows, types) {
  const out = [];
  types.forEach((info, c) => {
    if (info.type === 'text') return;
    const bad = new Map();
    for (const row of rows) {
      if (isBlank(row[c])) continue;
      if (convert(row[c], info) === null) bad.set(row[c], (bad.get(row[c]) || 0) + 1);
    }
    if (!bad.size) return;
    const count = [...bad.values()].reduce((a, b) => a + b, 0);
    out.push({
      kind: 'type_mismatch',
      column: headers[c],
      title: `${plural(count, 'value')} in “${headers[c]}” ${count === 1 ? 'is' : 'are'} not ${TYPE_NOUN[info.type]}`,
      detail: 'These cannot be used in calculations. Making them blank keeps the rest of the row.',
      fixLabel: 'Make them blank',
      count,
      examples: [...bad.entries()].slice(0, EXAMPLES).map(([value, n]) => ({
        before: `${value}${n > 1 ? `  (${n}×)` : ''}`,
        after: '(blank)',
      })),
      step: { op: 'blank_values', column: headers[c], values: [...bad.keys()] },
    });
  });
  return out;
}

function editDistanceAtMostOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

const spellingKey = (s) => s.toLowerCase().replace(/[\s._\-]+/g, '');

function spellings(headers, rows, types) {
  const out = [];
  types.forEach((info, c) => {
    if (info.type !== 'text') return;
    const counts = new Map();
    let filled = 0;
    for (const row of rows) {
      if (isBlank(row[c])) continue;
      filled++;
      counts.set(row[c], (counts.get(row[c]) || 0) + 1);
    }
    if (counts.size < 2) return;

    // 1. Same word written with different capitals, spacing or punctuation.
    const groups = new Map();
    for (const [value, n] of counts) {
      const key = spellingKey(value);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ value, n });
    }
    const map = {};
    const winners = new Map();
    for (const [key, variants] of groups) {
      variants.sort((a, b) => b.n - a.n);
      // Prefer a tidy spelling when it is as common as the alternatives.
      const tidy = variants.find((v) => v.n === variants[0].n && v.value === v.value.trim()) || variants[0];
      const winner = tidy.value.trim().replace(/\s+/g, ' ');
      winners.set(key, { value: winner, n: variants.reduce((a, v) => a + v.n, 0) });
      for (const v of variants) if (v.value !== winner) map[v.value] = winner;
    }

    // 2. Likely typos: one letter off from a much more common value. Only in
    // columns that hold a small set of categories, never in names or IDs.
    if (winners.size <= 30 && winners.size <= filled * 0.2) {
      const keys = [...winners.keys()];
      for (const rare of keys) {
        if (rare.length < 5 || /\d/.test(rare)) continue;
        for (const common of keys) {
          if (common === rare || /\d/.test(common)) continue;
          const r = winners.get(rare);
          const k = winners.get(common);
          if (k.n >= r.n * 3 && editDistanceAtMostOne(rare, common)) {
            for (const [value] of counts) if (spellingKey(value) === rare) map[value] = k.value;
            break;
          }
        }
      }
    }

    const changes = Object.keys(map);
    if (!changes.length) return;
    const count = changes.reduce((a, v) => a + counts.get(v), 0);
    out.push({
      kind: 'spellings',
      column: headers[c],
      title: `Inconsistent spellings in “${headers[c]}”`,
      detail: `${plural(changes.length, 'variant')} of the same value, affecting ${plural(count, 'row')}. Grouping would split them into separate lines.`,
      fixLabel: 'Use one spelling',
      count,
      examples: changes
        .sort((a, b) => counts.get(b) - counts.get(a))
        .slice(0, EXAMPLES)
        .map((v) => ({ before: `${JSON.stringify(v).slice(1, -1).replace(/^ +| +$/g, (m) => '␣'.repeat(m.length))}  (${counts.get(v)}×)`, after: map[v] })),
      step: { op: 'replace_values', column: headers[c], map },
    });
  });
  return out;
}

export function detectProblems(headers, rows, types) {
  const totals = totalsRow(headers, rows, types);
  // The totals row is reported once, not again for every column it does not fit.
  const body = totals ? rows.filter((_, i) => i !== totals.step.rows[0]) : rows;
  const found = [
    totals,
    blankRows(headers, rows),
    duplicateRows(headers, rows),
    ...typeMismatches(headers, body, types),
    ...spellings(headers, body, types),
  ].filter(Boolean);
  return found.map((p) => ({ ...p, id: p.column ? `${p.kind}:${p.column}` : p.kind }));
}
