// Page wiring: holds the loaded tables and the current question, and redraws
// the panels when either changes.

import { $, h, replace, toast } from './dom.js';
import { viewOf } from '../core/table.js';
import { plural, fmtDuration } from '../core/format.js';
import { buildSQL, newQuestion } from '../core/sqlgen.js';
import { describe } from '../core/sentence.js';
import { sampleStarters, genericStarters } from '../core/starters.js';
import { runLocally, canRunLocally } from '../core/localrun.js';
import { explainError } from '../core/errors.js';
import { startEngine, runSQL } from '../engine/duckdb.js';
import { readFiles, fetchExample, setupFileInput } from './files.js';
import { renderDataPanel } from './data-panel.js';
import { renderBuilder, repairQuestion } from './builder.js';
import { createEditor, highlightInto } from './editor.js';
import { createGrid } from './grid.js';
import { setupTheme } from './theme.js';

const SAMPLE_FILES = ['orders.csv', 'customers.csv', 'products.csv'];

const state = {
  tables: [],
  views: new Map(),
  active: null,      // table shown in the data panel
  sample: true,
  mode: 'build',     // 'build' or 'sql'
  question: null,    // what the builder is editing
  touched: false,    // has the user edited the builder since the last starter?
  starter: null,     // label of the starter currently shown
  result: null,
};

const grid = createGrid($('#grid'));
const editor = createEditor($('#sql-pane'), { onRun: (sql) => runEditor(sql) });

let engineReady = false;
startEngine().then(() => { engineReady = true; }, (err) => {
  $('#result-meta').textContent = `The query engine could not start (${err.message}).`;
});

// ---------- helpers ----------

const schema = () => Object.fromEntries(state.tables.map((t) => {
  const view = state.views.get(t.name);
  return [t.name, Object.fromEntries(view.headers.map((c, i) => [c, view.types[i].type]))];
}));

// Query results lose display hints such as "$" or "this is an ID". Put them
// back for result columns that carry a source column's name.
function decorate(result, question) {
  const units = new Map();
  for (const view of state.views.values()) {
    view.headers.forEach((name, i) => { if (view.types[i].unit && !units.has(name)) units.set(name, view.types[i].unit); });
  }
  for (const column of result.columns) {
    if (column.type !== 'number' || column.unit) continue;
    if (units.has(column.name)) column.unit = units.get(column.name);
    else if (/_year$/.test(column.name)) column.unit = 'id';
  }
  const calc = question?.calc;
  if (calc?.ref && calc.fn !== 'count') {
    const unit = units.get(calc.ref.column);
    const last = result.columns.at(-1);
    if (unit && unit !== 'id' && last.type === 'number') last.unit = unit;
  }
  return result;
}

// ---------- running ----------

let runToken = 0;

function showResult(result, { title, ms, note }) {
  state.result = { ...result, title };
  $('#result-error').hidden = true;
  $('#grid').hidden = false;
  $('#result-title').textContent = title;
  replace($('#result-meta'),
    plural(result.rowCount, 'row'),
    ms != null ? ` · ${fmtDuration(ms)}` : '',
    note ? h('span', { class: 'note', text: ` · ${note}` }) : null,
  );
  grid.set(result);
}

function showError(info, title) {
  state.result = null;
  $('#result-title').textContent = title;
  $('#result-meta').textContent = '';
  $('#grid').hidden = true;
  replace($('#result-error'),
    h('strong', { text: info.title }),
    h('p', { class: 'err-detail', text: info.detail }),
    info.hint && h('p', { text: info.hint }),
  );
  $('#result-error').hidden = false;
}

async function execute({ sql, title, question }) {
  const token = ++runToken;
  if (!engineReady) {
    if (question && canRunLocally(question)) {
      showResult(decorate(runLocally(question, state.views.get(question.table)), question), { title, note: 'instant preview while the query engine loads' });
    } else {
      $('#result-title').textContent = title;
      $('#result-meta').textContent = 'Loading the query engine (first visit only)…';
    }
  }
  try {
    const result = await runSQL(sql, state.tables.map((t) => ({ name: t.name, view: state.views.get(t.name) })));
    if (token !== runToken) return null;
    showResult(decorate(result, question), { title, ms: result.ms });
    return result;
  } catch (err) {
    if (token !== runToken) return null;
    const info = explainError(err, sql, schema());
    if (question) showError(info, title);
    else {
      editor.showError(info);
      showError({ title: info.title, detail: 'Details are under the editor above.' }, title);
    }
    return null;
  }
}

function runBuilder() {
  const q = state.question;
  if (!q) return;
  const sql = buildSQL(q, schema());
  const title = describe(q, schema());
  $('#sentence').textContent = title;
  highlightInto($('#generated-sql code'), sql);
  execute({ sql, title, question: structuredClone(q) });
}

function runEditor(sql) {
  if (!sql.trim()) return;
  editor.clearError();
  if (state.touched) state.starter = null;
  const comment = /^\s*--\s*(.+)/.exec(sql);
  execute({ sql, title: comment ? comment[1] : 'SQL result' });
}

let debounce;
function builderChanged(question, structural) {
  state.touched = true;
  state.starter = null;
  if (structural) renderAsk();
  else renderStarters();
  clearTimeout(debounce);
  debounce = setTimeout(runBuilder, structural ? 0 : 200);
}

// ---------- drawing ----------

function renderStarters() {
  const active = state.tables.find((t) => t.name === state.active);
  if (!active) return replace($('#starters'));
  const chip = (s) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(state.starter === s.label),
    onclick: () => {
      state.starter = s.label;
      state.touched = false;
      if (s.question) {
        state.question = structuredClone(s.question);
        setMode('build');
      } else {
        editor.set(s.sql);
        setMode('sql', { keepText: true });
        runEditor(s.sql);
      }
    },
  }, s.label);
  const generic = genericStarters(active.name, state.views.get(active.name).profile);
  replace($('#starters'),
    h('span', { class: 'starters-label', text: 'Try:' }),
    state.sample ? [sampleStarters().map(chip), h('span', { class: 'starters-break' }), h('span', { class: 'starters-label', text: `Works on any file (${active.name}):` })] : null,
    generic.map(chip),
  );
}

function renderAsk() {
  renderStarters();
  $('#mode-build').setAttribute('aria-pressed', String(state.mode === 'build'));
  $('#mode-sql').setAttribute('aria-pressed', String(state.mode === 'sql'));
  $('#build-pane').hidden = state.mode !== 'build';
  $('#sql-pane').hidden = state.mode !== 'sql';
  editor.setSchema(state.views);
  if (state.question) renderBuilder($('#builder'), state.question, state.views, builderChanged);
}

function setMode(mode, { keepText = false } = {}) {
  state.mode = mode;
  if (mode === 'sql' && !keepText && !editor.value.trim() && state.question) editor.set(buildSQL(state.question, schema()));
  renderAsk();
  if (mode === 'build') runBuilder();
  else editor.focus();
}

function render() {
  $('#sample').hidden = state.sample;
  $('#data-intro').textContent = state.sample
    ? 'This is made-up sample data from a fictional outdoor shop. Drop your own CSV or Excel files anywhere on the page.'
    : '';
  renderDataPanel($('#data-panel'), state, actions);
  renderAsk();
}

// Re-runs whatever is on screen after the data underneath it changed.
function rerun() {
  if (state.mode === 'sql' && editor.value.trim()) return runEditor(editor.value);
  state.question = (state.question && repairQuestion(state.question, state.views)) || newQuestion(state.active);
  renderAsk();
  runBuilder();
}

function changed(table) {
  state.views.set(table.name, viewOf(table));
  render();
  rerun();
}

const actions = {
  select(name) {
    state.active = name;
    // Peeking at another table shows its rows, unless a question is in progress.
    if (state.mode === 'build' && !state.touched) {
      state.question = newQuestion(name);
      state.starter = 'All rows';
      render();
      runBuilder();
    } else render();
  },
  setType(table, column, choice) {
    table.typeChoices[column] = choice;
    changed(table);
  },
  fix(table, steps) {
    table.recipe.push(...steps);
    changed(table);
  },
  fixAll(table) {
    // Fixing one problem can change the others (row numbers shift), so take
    // them one at a time and look again after each.
    let applied = 0;
    for (let guard = 0; guard < 100; guard++) {
      const { problems } = viewOf(table);
      if (!problems.length) break;
      table.recipe.push(problems[0].step);
      applied++;
    }
    changed(table);
    toast(`Applied ${plural(applied, 'fix', 'fixes')}. Undo is under “Fixes applied”.`);
  },
  undo(table) {
    table.recipe.pop();
    changed(table);
  },
  remove(name) {
    state.tables = state.tables.filter((t) => t.name !== name);
    state.views.delete(name);
    if (!state.tables.length) return loadSample();
    if (state.active === name) state.active = state.tables[0].name;
    render();
    rerun();
  },
};

function setTables(tables, { sample, append = false, starter = null }) {
  if (!append) {
    state.tables = [];
    state.views.clear();
  }
  state.sample = sample;
  for (const t of tables) {
    state.tables.push(t);
    state.views.set(t.name, viewOf(t));
  }
  state.active = tables[0].name;
  state.mode = 'build';
  state.touched = false;
  state.question = starter ? structuredClone(starter.question) : newQuestion(state.active);
  state.starter = starter ? starter.label : 'All rows';
  editor.set('');
  render();
  runBuilder();
}

async function addFiles(files) {
  const keep = !state.sample;
  const { tables, skipped } = await readFiles(files, keep ? state.tables.map((t) => t.name) : []);
  if (tables.length) setTables(tables, { sample: false, append: keep });
  if (skipped.length) toast(skipped.join('. '));
  else if (tables.length) toast(`Loaded ${plural(tables.length, 'table')}. Nothing left your browser.`);
}

async function loadSample() {
  try {
    const files = await Promise.all(SAMPLE_FILES.map(fetchExample));
    const { tables } = await readFiles(files);
    setTables(tables, { sample: true, starter: sampleStarters()[0] });
  } catch (err) {
    $('#data-panel').textContent = `The sample data could not be loaded (${err.message}). You can still drop your own files.`;
  }
}

async function loadMessy() {
  const { tables } = await readFiles([await fetchExample('messy-sales.csv')]);
  setTables(tables, { sample: false });
  toast('Loaded a deliberately messy export. See what the checker found.');
}

setupTheme($('#theme'));
setupFileInput({ input: $('#file-input'), overlay: $('#drop-overlay'), onFiles: addFiles });
$('#pick').addEventListener('click', () => $('#file-input').click());
$('#messy').addEventListener('click', loadMessy);
$('#sample').addEventListener('click', loadSample);
$('#mode-build').addEventListener('click', () => setMode('build'));
$('#mode-sql').addEventListener('click', () => setMode('sql'));
$('#edit-sql').addEventListener('click', () => {
  editor.set(buildSQL(state.question, schema()));
  setMode('sql', { keepText: true });
});
loadSample();
