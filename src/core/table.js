// A table keeps the rows exactly as read from the file, plus the cleanup recipe
// and any column types the user chose. Everything shown or queried is a view
// computed from those three things.

import { parseDelimited } from './csv.js';
import { decodeBytes, detectSeparator, detectHeader, SEPARATOR_NAMES } from './detect.js';
import { guessType, typeFor, convert } from './types.js';
import { profileTable } from './profile.js';
import { detectProblems } from './problems.js';
import { applyRecipe } from './recipe.js';

export function tableName(raw, taken = []) {
  let base = String(raw)
    .replace(/\.(csv|tsv|txt|xlsx|xlsm|xls)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) base = 'table';
  if (/^\d/.test(base)) base = 't_' + base;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}_${n}`;
  return name;
}

export function tableFromGrid(name, source, grid, notes = {}) {
  const { headers, rows, headerIndex, hasHeader, skipped } = detectHeader(grid);
  return {
    name,
    source,
    headers,
    rawRows: rows,
    recipe: [],
    typeChoices: {},
    notes: { ...notes, headerLine: headerIndex + 1, hasHeader, skipped },
  };
}

export function tableFromBytes(name, source, bytes) {
  const { text, encoding } = decodeBytes(bytes);
  const sep = detectSeparator(text);
  const grid = parseDelimited(text, sep);
  return tableFromGrid(name, source, grid, { encoding, separator: SEPARATOR_NAMES[sep] });
}

// Excel stores dates as day counts; turn them into ISO text so that they go
// through the same type guessing as CSV values.
function excelDate(serial, date1904) {
  const ms = Math.round((serial - (date1904 ? -1462 : 0) - 25569) * 86400000);
  const d = new Date(ms);
  const day = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19);
  return time === '00:00:00' ? day : `${day} ${time}`;
}

export function gridFromSheet(XLSX, sheet, date1904 = false) {
  if (!sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const grid = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v == null) row.push('');
      else if (cell.t === 'n') row.push(cell.z && XLSX.SSF.is_date(cell.z) ? excelDate(cell.v, date1904) : String(cell.v));
      else if (cell.t === 'b') row.push(cell.v ? 'Yes' : 'No');
      else if (cell.t === 'd') row.push(new Date(cell.v).toISOString().slice(0, 10));
      else row.push(String(cell.w ?? cell.v));
    }
    grid.push(row);
  }
  return grid;
}

export function tablesFromWorkbook(XLSX, source, bytes, taken = []) {
  const wb = XLSX.read(bytes, { type: 'array', cellNF: true, cellDates: false });
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const names = [...taken];
  const tables = [];
  for (const sheetName of wb.SheetNames) {
    const grid = gridFromSheet(XLSX, wb.Sheets[sheetName], date1904);
    if (!grid.some((row) => row.some((c) => c !== ''))) continue;
    const label = wb.SheetNames.length > 1 ? `${source.replace(/\.[^.]+$/, '')} ${sheetName}` : source;
    const name = tableName(label, names);
    names.push(name);
    tables.push(tableFromGrid(name, wb.SheetNames.length > 1 ? `${source} › ${sheetName}` : source, grid, { sheet: sheetName }));
  }
  return tables;
}

// The cleaned, typed view of a table: what the summary, the problems panel and
// the query engine all work from.
export function viewOf(table) {
  const { headers } = table;
  const rows = applyRecipe(headers, table.rawRows, table.recipe);
  const types = headers.map((h, c) => {
    const values = rows.map((r) => r[c]);
    const choice = table.typeChoices[h];
    const info = choice ? typeFor(values, choice.type, choice.order) : guessType(values);
    // Whole-number ID columns are shown as written (10001, not 10,001) and are
    // not averaged in the summary.
    if (info.type === 'number' && /(^|[ _])(id|no|number|code|zip)$/i.test(h) && values.every((v) => /^\d*$/.test(v.trim()))) info.unit = 'id';
    return info;
  });
  const columns = headers.map((_, c) => rows.map((r) => convert(r[c], types[c])));
  return {
    headers,
    rows,
    types,
    columns,
    profile: profileTable(headers, types, columns),
    problems: detectProblems(headers, rows, types),
  };
}
