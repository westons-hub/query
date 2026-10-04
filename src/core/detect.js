// Works out how a file is laid out: its encoding, its separator, and which
// line holds the real column headers.

import { parseDelimited } from './csv.js';
import { parseNumber, parseDate, isBlank } from './types.js';

export function decodeBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'UTF-8' };
  }
  if (b[0] === 0xff && b[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16' };
  }
  if (b[0] === 0xfe && b[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8' };
  } catch {
    // Not valid UTF-8: almost always an Excel export in the Western Windows code page.
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252' };
  }
}

const SEPARATORS = ['\t', ';', ',', '|'];
export const SEPARATOR_NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

function widthStats(rows) {
  const counts = new Map();
  let lines = 0;
  for (const row of rows) {
    if (row.length === 1 && row[0].trim() === '') continue;
    lines++;
    counts.set(row.length, (counts.get(row.length) || 0) + 1);
  }
  let width = 1;
  let best = 0;
  for (const [w, c] of counts) {
    if (w > 1 && (c > best || (c === best && w > width))) { width = w; best = c; }
  }
  return { width, share: lines ? best / lines : 0 };
}

export function detectSeparator(text) {
  const sample = text.slice(0, 64 * 1024);
  let fallback = { sep: ',', score: 0 };
  for (const sep of SEPARATORS) {
    const { width, share } = widthStats(parseDelimited(sample, sep, 60));
    // A separator that splits most lines into the same number of fields wins
    // outright. Tab and semicolon are checked before comma because files that
    // use them often have commas inside numbers ("1.200,50").
    if (width >= 2 && share >= 0.6) return sep;
    const score = share * (width - 1);
    if (score > fallback.score) fallback = { sep, score };
  }
  return fallback.sep;
}

function filledCount(row) {
  let n = 0;
  for (const cell of row) if (!isBlank(cell)) n++;
  return n;
}

function looksLikeData(cell) {
  return parseNumber(cell) !== null || parseNumber(cell, ',') !== null || parseDate(cell) !== null;
}

// Finds the header row in a grid of strings, skipping title/notes lines above it.
export function detectHeader(grid) {
  // The usual number of filled cells per row tells us how wide the real table is.
  const counts = new Map();
  for (const row of grid.slice(0, 200)) {
    const n = filledCount(row);
    if (n >= 2) counts.set(n, (counts.get(n) || 0) + 1);
  }
  let typical = 1;
  let best = 0;
  for (const [n, c] of counts) if (c > best || (c === best && n > typical)) { typical = n; best = c; }
  const needed = typical === 1 ? 1 : Math.max(2, Math.ceil(typical * 0.6));

  let headerIndex = grid.findIndex((row) => filledCount(row) >= needed);
  if (headerIndex === -1) headerIndex = 0;
  const candidate = grid[headerIndex] || [];
  const hasHeader = candidate.length > 0 && !candidate.some((c) => !isBlank(c) && looksLikeData(c));

  const dataStart = hasHeader ? headerIndex + 1 : headerIndex;
  let width = candidate.length;
  while (width > 0 && isBlank(candidate[width - 1])) width--;
  for (let i = dataStart; i < Math.min(grid.length, dataStart + 200); i++) {
    let w = grid[i].length;
    while (w > 0 && isBlank(grid[i][w - 1])) w--;
    if (w > width) width = w;
  }
  width = Math.max(width, 1);

  const seen = new Map();
  const headers = [];
  for (let c = 0; c < width; c++) {
    let name = hasHeader ? String(candidate[c] ?? '').replace(/\s+/g, ' ').trim() : '';
    if (!name) name = `column_${c + 1}`;
    const key = name.toLowerCase();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    headers.push(n > 1 ? `${name}_${n}` : name);
  }

  const rows = [];
  for (let i = dataStart; i < grid.length; i++) {
    const src = grid[i];
    const row = new Array(width);
    for (let c = 0; c < width; c++) row[c] = src[c] == null ? '' : String(src[c]);
    rows.push(row);
  }
  // A trailing empty line is an artefact of the file ending in a newline.
  while (rows.length && rows[rows.length - 1].every(isBlank) && grid[grid.length - 1].length <= 1) rows.pop();

  const skipped = grid
    .slice(0, headerIndex)
    .map((r) => r.filter((c) => !isBlank(c)).join(' '))
    .filter(Boolean);

  return { headers, rows, headerIndex, hasHeader, skipped };
}
