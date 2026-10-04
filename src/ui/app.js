// Page wiring: holds the loaded tables and redraws the panels when they change.

import { $, toast } from './dom.js';
import { viewOf } from '../core/table.js';
import { plural } from '../core/format.js';
import { readFiles, fetchExample, setupFileInput } from './files.js';
import { renderDataPanel } from './data-panel.js';
import { createGrid } from './grid.js';
import { setupTheme } from './theme.js';

const SAMPLE_FILES = ['orders.csv', 'customers.csv', 'products.csv'];

const state = {
  tables: [],
  views: new Map(),
  active: null,
  sample: true,
};

const grid = createGrid($('#grid'));

function refresh(table) {
  state.views.set(table.name, viewOf(table));
}

export function gridData(view) {
  return {
    rowCount: view.profile.rowCount,
    columns: view.headers.map((name, i) => ({ name, type: view.types[i].type, unit: view.types[i].unit, values: view.columns[i] })),
  };
}

function render() {
  $('#sample').hidden = state.sample;
  $('#data-intro').textContent = state.sample
    ? 'This is made-up sample data from a fictional outdoor shop. Drop your own CSV or Excel files anywhere on the page.'
    : '';
  renderDataPanel($('#data-panel'), state, actions);
  const table = state.tables.find((t) => t.name === state.active);
  if (!table) return;
  const view = state.views.get(table.name);
  $('#answer-title').textContent = `Rows in ${table.name}`;
  $('#result-meta').textContent = plural(view.profile.rowCount, 'row');
  grid.set(gridData(view));
}

function changed(table) {
  refresh(table);
  render();
}

const actions = {
  select(name) {
    state.active = name;
    render();
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
  },
};

function setTables(tables, { sample, append = false }) {
  if (!append) {
    state.tables = [];
    state.views.clear();
  }
  state.sample = sample;
  for (const t of tables) {
    state.tables.push(t);
    refresh(t);
  }
  state.active = tables[0].name;
  render();
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
    setTables(tables, { sample: true });
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
loadSample();
