// Reads dropped or picked files into tables. Files are read with the browser's
// File API and never leave the page.

import { tableFromBytes, tablesFromWorkbook, tableName } from '../core/table.js';

const EXCEL = /\.(xlsx|xlsm|xls)$/i;
const TEXT = /\.(csv|tsv|txt)$/i;

let xlsxPromise;
export const loadXLSX = () => (xlsxPromise ||= import('../../vendor/sheetjs/xlsx.mjs'));

export async function readFiles(files, taken = []) {
  const names = [...taken];
  const tables = [];
  const skipped = [];
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (EXCEL.test(file.name)) {
        const XLSX = await loadXLSX();
        const sheets = tablesFromWorkbook(XLSX, file.name, bytes, names);
        if (!sheets.length) skipped.push(`${file.name} has no data`);
        for (const t of sheets) { names.push(t.name); tables.push(t); }
      } else if (TEXT.test(file.name) || file.type.startsWith('text/')) {
        const name = tableName(file.name, names);
        const table = tableFromBytes(name, file.name, bytes);
        if (!table.rawRows.length) { skipped.push(`${file.name} has no rows`); continue; }
        names.push(name);
        tables.push(table);
      } else {
        skipped.push(`${file.name} is not a CSV, TSV or Excel file`);
      }
    } catch (err) {
      skipped.push(`${file.name} could not be read (${err.message})`);
    }
  }
  return { tables, skipped };
}

export async function fetchExample(file) {
  const url = new URL(`../../examples/${file}`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${file}`);
  return new File([await res.arrayBuffer()], file);
}

// Calls onFiles when files are dropped anywhere on the page or picked.
export function setupFileInput({ input, overlay, onFiles }) {
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    onFiles([...e.dataTransfer.files]);
  });
  input.addEventListener('change', () => {
    if (input.files.length) onFiles([...input.files]);
    input.value = '';
  });
}
