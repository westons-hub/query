// Builds the summary shown for a table before any question is asked.

export function profileColumn(name, info, values) {
  const counts = new Map();
  let blanks = 0;
  let sum = 0;
  let min = null;
  let max = null;
  for (const v of values) {
    if (v === null) { blanks++; continue; }
    counts.set(v, (counts.get(v) || 0) + 1);
    if (info.type === 'number') sum += v;
    if (info.type === 'number' || info.type === 'date') {
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
    }
  }
  const filled = values.length - blanks;
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (String(a[0]) < String(b[0]) ? -1 : 1))
    .slice(0, 5)
    .map(([value, count]) => ({ value, count, pct: filled ? (count / filled) * 100 : 0 }));

  const col = { name, type: info.type, blanks, filled, distinct: counts.size, top };
  if (info.type === 'number') {
    Object.assign(col, { min, max, sum, mean: filled ? sum / filled : null, unit: info.unit || '' });
  }
  if (info.type === 'date') Object.assign(col, { min, max });
  return col;
}

export function profileTable(headers, types, columns) {
  return {
    rowCount: columns.length ? columns[0].length : 0,
    colCount: headers.length,
    columns: headers.map((h, i) => profileColumn(h, types[i], columns[i])),
  };
}
