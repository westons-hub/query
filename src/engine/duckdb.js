// DuckDB-WASM, loaded from this site's own vendor/ folder and run in a worker.
// Tables are copied in from the cleaned views; queries come back as plain
// column arrays.

import { toDelimited } from '../core/csv.js';
import { ident, text } from '../core/sqlgen.js';

const asset = (file) => new URL(`../../vendor/duckdb/${file}`, import.meta.url).href;

let ready = null;
let db = null;
let conn = null;
const loaded = new Map(); // table name -> the view object currently in the database

export function startEngine() {
  ready ||= (async () => {
    const duckdb = await import('../../vendor/duckdb/duckdb-browser.bundle.mjs');
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: asset('duckdb-mvp.wasm'), mainWorker: asset('duckdb-browser-mvp.worker.js') },
      eh: { mainModule: asset('duckdb-eh.wasm'), mainWorker: asset('duckdb-browser-eh.worker.js') },
    });
    const worker = new Worker(bundle.mainWorker);
    db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule);
    await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
    conn = await db.connect();
  })();
  return ready;
}

function sqlType(info, values) {
  if (info.type === 'number') return values.every((v) => v === null || Number.isInteger(v)) ? 'BIGINT' : 'DOUBLE';
  if (info.type === 'date') return info.hasTime ? 'TIMESTAMP' : 'DATE';
  if (info.type === 'bool') return 'BOOLEAN';
  return 'VARCHAR';
}

async function loadTable(name, view) {
  const types = view.types.map((info, i) => sqlType(info, view.columns[i]));
  const rows = new Array(view.profile.rowCount);
  for (let r = 0; r < rows.length; r++) {
    rows[r] = view.columns.map((values, c) => {
      const v = values[r];
      if (v === null) return '';
      if (types[c] === 'DATE') return v.slice(0, 10);
      return v;
    });
  }
  const file = `${name}.csv`;
  await db.registerFileText(file, toDelimited(view.headers, rows));
  const columns = view.headers.map((h, i) => `${text(h)}: ${text(types[i])}`).join(', ');
  await conn.query(
    `CREATE OR REPLACE TABLE ${ident(name)} AS SELECT * FROM read_csv(${text(file)}, header = true, delim = ',', quote = '"', escape = '"', nullstr = '', columns = {${columns}})`,
  );
  await db.dropFile(file);
}

// The database handles one thing at a time; requests queue up behind each other.
let queue = Promise.resolve();
const inTurn = (fn) => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
};

// Makes the database match the given tables: [{ name, view }].
async function syncTables(tables) {
  await startEngine();
  for (const { name, view } of tables) {
    if (loaded.get(name) === view) continue;
    await loadTable(name, view);
    loaded.set(name, view);
  }
  const keep = new Set(tables.map((t) => t.name));
  for (const name of [...loaded.keys()]) {
    if (keep.has(name)) continue;
    await conn.query(`DROP TABLE IF EXISTS ${ident(name)}`);
    loaded.delete(name);
  }
}

const pad = (n) => String(n).padStart(2, '0');
function isoFromMs(ms, withTime) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return null;
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : day;
}

function columnFrom(field, vector) {
  const kind = String(field.type);
  const n = vector.length;
  const values = new Array(n);
  let type = 'text';
  if (/^(Int|Uint|Float|Decimal)/.test(kind)) {
    type = 'number';
    for (let i = 0; i < n; i++) { const v = vector.get(i); values[i] = v == null ? null : Number(v); }
  } else if (/^(Date|Timestamp)/.test(kind)) {
    type = 'date';
    const withTime = kind.startsWith('Timestamp');
    for (let i = 0; i < n; i++) { const v = vector.get(i); values[i] = v == null ? null : isoFromMs(v, withTime); }
  } else if (kind === 'Bool') {
    type = 'bool';
    for (let i = 0; i < n; i++) { const v = vector.get(i); values[i] = v == null ? null : Boolean(v); }
  } else {
    for (let i = 0; i < n; i++) { const v = vector.get(i); values[i] = v == null ? null : typeof v === 'string' ? v : String(v); }
  }
  return { name: field.name, type, values };
}

// Runs SQL against the given tables and returns
// { columns: [{ name, type, values }], rowCount, ms }.
export function runSQL(sql, tables) {
  return inTurn(async () => {
    await syncTables(tables);
    return query(sql);
  });
}

async function query(sql) {
  const started = performance.now();
  const table = await conn.query(sql);
  const ms = performance.now() - started;
  const columns = table.schema.fields.map((field, i) => columnFrom(field, table.getChildAt(i)));
  return { columns, rowCount: table.numRows, ms };
}
