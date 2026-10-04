// Delimited-text parser. Handles quoted fields, doubled quotes, separators and
// line breaks inside quotes, and \n / \r\n / \r line endings.

export function parseDelimited(text, sep = ',', maxRows = Infinity) {
  const rows = [];
  const n = text.length;
  let row = [];
  let i = 0;

  while (i < n && rows.length < maxRows) {
    let field;
    if (text[i] === '"') {
      // Quoted field: read to the closing quote, un-doubling "" as we go.
      field = '';
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q === -1) { field += text.slice(i); i = n; break; }
        field += text.slice(i, q);
        if (text[q + 1] === '"') { field += '"'; i = q + 2; continue; }
        i = q + 1;
        break;
      }
      // Anything between the closing quote and the next separator is kept as-is.
      const start = i;
      while (i < n && text[i] !== sep && text[i] !== '\n' && text[i] !== '\r') i++;
      if (i > start) field += text.slice(start, i);
    } else {
      const start = i;
      while (i < n && text[i] !== sep && text[i] !== '\n' && text[i] !== '\r') i++;
      field = text.slice(start, i);
    }
    row.push(field);

    if (i >= n) break;
    const ch = text[i];
    if (ch === sep) {
      i++;
      if (i >= n) row.push('');
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') i += 2; else i++;
    rows.push(row);
    row = [];
  }
  if (row.length && rows.length < maxRows) rows.push(row);
  return rows;
}

function quoteField(value, sep) {
  const s = value == null ? '' : String(value);
  return s.includes('"') || s.includes(sep) || s.includes('\n') || s.includes('\r')
    ? '"' + s.replaceAll('"', '""') + '"'
    : s;
}

export function toDelimited(headers, rows, sep = ',') {
  const lines = [headers.map((h) => quoteField(h, sep)).join(sep)];
  for (const row of rows) lines.push(row.map((v) => quoteField(v, sep)).join(sep));
  return lines.join('\n') + '\n';
}
