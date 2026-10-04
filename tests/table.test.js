import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from '../vendor/sheetjs/xlsx.mjs';
import { tableFromBytes, tablesFromWorkbook, tableName, viewOf } from '../src/core/table.js';
import { applyRecipe } from '../src/core/recipe.js';

const bytes = (text) => new TextEncoder().encode(text);
const example = (name) => readFileSync(new URL(`../examples/${name}`, import.meta.url));

test('table names are safe identifiers and unique', () => {
  assert.equal(tableName('Q1 Sales (final).csv'), 'q1_sales_final');
  assert.equal(tableName('2024.xlsx'), 't_2024');
  assert.equal(tableName('orders.csv', ['orders']), 'orders_2');
  assert.equal(tableName('???'), 'table');
});

test('summary: counts, blanks, distinct, min/max/average, top values', () => {
  const t = tableFromBytes('t', 't.csv', bytes('city,sales,day\nOslo,10,2024-01-01\nOslo,30,2024-01-03\nRome,,2024-01-02\n,20,\n'));
  const { profile } = viewOf(t);
  assert.equal(profile.rowCount, 4);
  assert.equal(profile.colCount, 3);
  const [city, sales, day] = profile.columns;
  assert.equal(city.type, 'text');
  assert.equal(city.blanks, 1);
  assert.equal(city.distinct, 2);
  assert.deepEqual(city.top[0], { value: 'Oslo', count: 2, pct: (2 / 3) * 100 });
  assert.equal(sales.type, 'number');
  assert.deepEqual([sales.min, sales.max, sales.mean, sales.sum, sales.blanks], [10, 30, 20, 60, 1]);
  assert.equal(day.type, 'date');
  assert.deepEqual([day.min, day.max], ['2024-01-01', '2024-01-03']);
});

test('sample data loads cleanly with no problems', () => {
  for (const [file, rows] of [['orders.csv', 1500], ['customers.csv', 80], ['products.csv', 24]]) {
    const view = viewOf(tableFromBytes('t', file, example(file)));
    assert.equal(view.profile.rowCount, rows);
    assert.deepEqual(view.problems, [], file);
  }
});

test('messy example: layout is detected', () => {
  const t = tableFromBytes('messy', 'messy-sales.csv', example('messy-sales.csv'));
  assert.equal(t.notes.separator, 'semicolon');
  assert.equal(t.notes.headerLine, 4);
  assert.equal(t.notes.skipped.length, 2);
  assert.deepEqual(t.headers, ['Date', 'Region', 'Sales Rep', 'Category', 'Units', 'Revenue', 'Discount', 'Paid']);
  const { types } = viewOf(t);
  assert.deepEqual(types.map((x) => x.type), ['date', 'text', 'text', 'text', 'number', 'number', 'number', 'bool']);
  assert.equal(types[0].order, 'DMY');
  assert.equal(types[5].decimal, ',');
  assert.equal(types[5].unit, '€');
  assert.equal(types[6].unit, '%');
});

test('messy example: every problem is found, fixed, and can be undone', () => {
  const t = tableFromBytes('messy', 'messy-sales.csv', example('messy-sales.csv'));
  const original = structuredClone(t.rawRows);
  const kinds = viewOf(t).problems.map((p) => p.id);
  assert.deepEqual(kinds, [
    'totals_row', 'blank_rows', 'duplicate_rows',
    'type_mismatch:Units', 'type_mismatch:Revenue',
    'spellings:Region', 'spellings:Category',
  ]);

  // Apply fixes one at a time, always taking the first remaining problem.
  const history = [];
  for (let guard = 0; guard < 20; guard++) {
    const view = viewOf(t);
    if (!view.problems.length) break;
    history.push(view.profile.rowCount);
    t.recipe.push(view.problems[0].step);
  }
  const clean = viewOf(t);
  assert.deepEqual(clean.problems, []);
  assert.equal(clean.profile.rowCount, 90);
  const region = clean.profile.columns[1];
  assert.deepEqual(region.top.map((x) => x.value).sort(), ['East', 'North', 'South', 'West']);
  assert.equal(clean.profile.columns[3].distinct, 4);

  // The rows read from the file were never touched.
  assert.deepEqual(t.rawRows, original);

  // Undo is dropping the last step.
  while (t.recipe.length) {
    t.recipe.pop();
    assert.equal(viewOf(t).profile.rowCount, history.pop());
  }
  assert.equal(viewOf(t).problems.length, 7);
});

test('totals row without a label is found by its sums', () => {
  const t = tableFromBytes('t', 't.csv', bytes('item,qty,price\na,1,2.5\nb,2,3.5\nc,3,4\nd,4,1\n,10,11\n'));
  const p = viewOf(t).problems.find((x) => x.kind === 'totals_row');
  assert.deepEqual(p.step, { op: 'remove_rows', rows: [4] });
});

test('an ordinary last row is not mistaken for a totals row', () => {
  const t = tableFromBytes('t', 't.csv', bytes('item,qty\na,1\nb,2\nc,3\nd,6\n'));
  assert.equal(viewOf(t).problems.length, 0);
});

test('spellings: typos are only suggested in category-like columns', () => {
  const rows = ['name,team'];
  for (let i = 0; i < 30; i++) rows.push(`Person${i},Marketing`);
  rows.push('Jon Smith,Marketting', 'John Smith,Sales', 'Joan Smith,Sales', 'Jan Smith,Sales');
  const view = viewOf(tableFromBytes('t', 't.csv', bytes(rows.join('\n'))));
  assert.deepEqual(view.problems.map((p) => p.id), ['spellings:team']);
  assert.deepEqual(view.problems[0].step.map, { Marketting: 'Marketing' });
});

test('spellings: capitals, spaces and punctuation', () => {
  const view = viewOf(tableFromBytes('t', 't.csv', bytes('r\nNew York\nNew York\nnew york\nNEW-YORK\n New York \nBoston\n')));
  assert.deepEqual(view.problems.find((p) => p.kind === 'spellings').step.map, { 'new york': 'New York', 'NEW-YORK': 'New York', ' New York ': 'New York' });
});

test('recipe steps never modify their input', () => {
  const rows = [['a', '1'], ['a', '1'], ['', '']];
  const frozen = structuredClone(rows);
  const out = applyRecipe(['x', 'y'], rows, [
    { op: 'remove_duplicates' }, { op: 'remove_blank_rows' }, { op: 'replace_values', column: 'x', map: { a: 'A' } },
    { op: 'blank_values', column: 'y', values: ['1'] },
  ]);
  assert.deepEqual(out, [['A', '']]);
  assert.deepEqual(rows, frozen);
});

test('changing a column type by hand', () => {
  const t = tableFromBytes('t', 't.csv', bytes('zip,when\n00123,01/02/2024\n04567,03/04/2024\n'));
  assert.deepEqual(viewOf(t).types.map((x) => x.type), ['text', 'date']);
  t.typeChoices.zip = { type: 'number' };
  t.typeChoices.when = { type: 'date', order: 'DMY' };
  const view = viewOf(t);
  assert.deepEqual(view.columns[0], [123, 4567]);
  assert.deepEqual(view.columns[1], ['2024-02-01', '2024-04-03']);
});

test('Excel: each sheet becomes a table; dates and numbers survive', () => {
  const wb = XLSX.utils.book_new();
  const a = XLSX.utils.aoa_to_sheet([
    ['Team report'], [],
    ['name', 'joined', 'score', 'active'],
    ['Ada', new Date(Date.UTC(2024, 1, 29)), 91.25, true],
    ['Bo', new Date(Date.UTC(2023, 11, 1)), 78, false],
  ], { cellDates: false, UTC: true });
  XLSX.utils.book_append_sheet(wb, a, 'People');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['k', 'v'], ['x', 1]]), 'Other');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Empty');
  const file = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const tables = tablesFromWorkbook(XLSX, 'Team.xlsx', new Uint8Array(file));
  assert.deepEqual(tables.map((t) => t.name), ['team_people', 'team_other']);
  assert.equal(tables[0].notes.headerLine, 3);
  const view = viewOf(tables[0]);
  assert.deepEqual(view.types.map((x) => x.type), ['text', 'date', 'number', 'bool']);
  assert.deepEqual(view.columns[1], ['2024-02-29', '2023-12-01']);
  assert.deepEqual(view.columns[2], [91.25, 78]);
  assert.deepEqual(view.columns[3], [true, false]);
});
