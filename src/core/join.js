// Checks how well two columns match before joining on them.

const key = (v) => (v == null ? null : String(v).trim().toLowerCase() === '' ? null : String(v).trim());

export function joinStats(leftValues, rightValues) {
  const right = new Map();
  for (const v of rightValues) {
    const k = key(v);
    if (k !== null) right.set(k, (right.get(k) || 0) + 1);
  }
  const used = new Set();
  const missing = new Map();
  let unmatched = 0;
  let blank = 0;
  for (const v of leftValues) {
    const k = key(v);
    if (k === null) { blank++; continue; }
    if (right.has(k)) used.add(k);
    else { unmatched++; missing.set(k, (missing.get(k) || 0) + 1); }
  }
  let repeated = 0;
  for (const n of right.values()) if (n > 1) repeated++;
  return {
    leftRows: leftValues.length,
    matched: leftValues.length - unmatched - blank,
    unmatched,                          // left rows with a value that has no partner
    blank,                              // left rows with nothing to match on
    examples: [...missing.keys()].slice(0, 3),
    rightUnused: right.size - used.size, // right values that no left row points at
    rightRepeated: repeated,             // right values appearing more than once: rows will multiply
  };
}

export function joinWarnings(stats, leftTable, rightTable) {
  const n = (x) => x.toLocaleString('en-US');
  const out = [];
  if (stats.unmatched) {
    out.push(`${n(stats.unmatched)} of ${n(stats.leftRows)} rows in ${leftTable} have no match in ${rightTable} (for example ${stats.examples.join(', ')}). They are kept, with blanks for the ${rightTable} columns.`);
  }
  if (stats.blank) out.push(`${n(stats.blank)} rows in ${leftTable} are blank in the matching column.`);
  if (stats.rightRepeated) {
    out.push(`${n(stats.rightRepeated)} values appear more than once in ${rightTable}, so some ${leftTable} rows will be repeated and totals may be inflated.`);
  }
  if (stats.matched === 0 && stats.leftRows > 0) out.push('Nothing matches. These are probably not the right columns to match on.');
  return out;
}

// Suggests the most likely pair of columns to match two tables on.
export function suggestJoin(leftView, rightView) {
  let best = null;
  leftView.headers.forEach((l, li) => {
    rightView.headers.forEach((r, ri) => {
      if (leftView.types[li].type !== rightView.types[ri].type) return;
      const sameName = l.toLowerCase() === r.toLowerCase();
      const stats = joinStats(leftView.columns[li], rightView.columns[ri]);
      if (!stats.matched) return;
      const score = stats.matched / stats.leftRows + (sameName ? 1 : 0) - (stats.rightRepeated ? 0.5 : 0);
      if (!best || score > best.score) best = { left: l, right: r, score };
    });
  });
  return best && best.score >= 0.5 ? { left: best.left, right: best.right } : null;
}
