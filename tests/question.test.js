import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSQL, newQuestion, col, ident, opsFor, requiredColumns } from '../src/core/sqlgen.js';
import { describe } from '../src/core/sentence.js';
import { joinStats, joinWarnings, suggestJoin } from '../src/core/join.js';
import { sampleStarters, genericStarters } from '../src/core/starters.js';
import { runLocally, canRunLocally } from '../src/core/localrun.js';
import { tableFromBytes, viewOf } from '../src/core/table.js';

const schema = {
  orders: { order_id: 'number', order_date: 'date', customer_id: 'text', amount: 'number', status: 'text', paid: 'bool', 'Sales Rep': 'text' },
  customers: { customer_id: 'text', region: 'text' },
};
const q = (extra) => ({ ...newQuestion('orders'), ...extra });
const amount = col('orders', 'amount');
const status = col('orders', 'status');

test('identifiers are quoted only when needed', () => {
  assert.equal(ident('amount'), 'amount');
  assert.equal(ident('Sales Rep'), '"Sales Rep"');
  assert.equal(ident('order'), '"order"');
  assert.equal(ident('Date'), '"Date"');
  assert.equal(ident('a"b'), '"a""b"');
  assert.equal(ident('2024'), '"2024"');
});

test('all rows', () => {
  assert.equal(buildSQL(q(), schema), 'SELECT *\nFROM orders');
  assert.equal(describe(q(), schema), 'All rows in orders');
});

test('chosen columns, sort and limit', () => {
  const question = q({ columns: [col('orders', 'order_id'), amount], sort: { by: amount, dir: 'desc' }, limit: 10 });
  assert.equal(buildSQL(question, schema), 'SELECT order_id, amount\nFROM orders\nORDER BY amount DESC NULLS LAST\nLIMIT 10');
  assert.equal(describe(question, schema), 'Order_id and amount from orders, amount highest first, first 10 rows');
});

test('each calculation', () => {
  const sql = (fn) => buildSQL(q({ calc: fn === 'count' ? { fn } : { fn, ref: amount } }), schema).split('\n')[0];
  assert.equal(sql('count'), 'SELECT COUNT(*) AS row_count');
  assert.equal(sql('sum'), 'SELECT SUM(amount) AS total_amount');
  assert.equal(sql('avg'), 'SELECT AVG(amount) AS average_amount');
  assert.equal(sql('min'), 'SELECT MIN(amount) AS smallest_amount');
  assert.equal(sql('max'), 'SELECT MAX(amount) AS largest_amount');
  assert.equal(describe(q({ calc: { fn: 'avg', ref: amount } }), schema), 'Average amount in orders');
});

test('group by with a total, biggest first', () => {
  const question = q({ groupBy: [{ ref: status }], calc: { fn: 'sum', ref: amount }, sort: { by: 'calc', dir: 'desc' } });
  assert.equal(buildSQL(question, schema), 'SELECT status, SUM(amount) AS total_amount\nFROM orders\nGROUP BY status\nORDER BY total_amount DESC NULLS LAST');
  assert.equal(describe(question, schema), 'Total amount by status, biggest first');
});

test('grouping without a calculation counts rows', () => {
  const question = q({ groupBy: [{ ref: status }] });
  assert.match(buildSQL(question, schema), /^SELECT status, COUNT\(\*\) AS row_count\n/);
  assert.equal(describe(question, schema), 'Number of rows by status');
});

test('group by month and year', () => {
  const date = col('orders', 'order_date');
  const month = q({ groupBy: [{ ref: date, bucket: 'month' }], calc: { fn: 'sum', ref: amount }, sort: { by: date, dir: 'asc' } });
  assert.equal(buildSQL(month, schema),
    "SELECT strftime(order_date, '%Y-%m') AS order_date_month, SUM(amount) AS total_amount\nFROM orders\nGROUP BY strftime(order_date, '%Y-%m')\nORDER BY order_date_month NULLS LAST");
  assert.equal(describe(month, schema), 'Total amount by month, oldest first');
  const year = q({ groupBy: [{ ref: date, bucket: 'year' }] });
  assert.match(buildSQL(year, schema), /SELECT year\(order_date\) AS order_date_year, COUNT/);
});

test('filters use the column type for values', () => {
  const question = q({ filters: [
    { ref: status, op: 'eq', value: "O'Brien" },
    { ref: amount, op: 'gt', value: '$1,200' },
    { ref: col('orders', 'order_date'), op: 'gte', value: '2024-03-01' },
    { ref: col('orders', 'paid'), op: 'eq', value: 'yes' },
    { ref: status, op: 'contains', value: '50%' },
    { ref: status, op: 'starts', value: 'Del' },
    { ref: amount, op: 'blank' },
    { ref: col('orders', 'Sales Rep'), op: 'not_blank' },
  ] });
  assert.equal(buildSQL(question, schema).split('WHERE ')[1], [
    "status = 'O''Brien'",
    'amount > 1200',
    "order_date >= DATE '2024-03-01'",
    'paid = TRUE',
    "status ILIKE '%50\\%%' ESCAPE '\\'",
    "status ILIKE 'Del%'",
    'amount IS NULL',
    '"Sales Rep" IS NOT NULL',
  ].join('\n  AND '));
});

test('half-finished filters are ignored rather than producing broken SQL', () => {
  const question = q({ filters: [{ ref: amount, op: 'gt', value: '' }, { ref: amount, op: 'gt', value: 'abc' }, { ref: status, op: 'eq', value: '' }, { ref: null, op: 'eq', value: 'x' }] });
  assert.equal(buildSQL(question, schema), 'SELECT *\nFROM orders');
  assert.equal(describe(question, schema), 'All rows in orders');
});

test('filter wording', () => {
  const question = q({ calc: { fn: 'count' }, filters: [{ ref: status, op: 'eq', value: 'Returned' }, { ref: amount, op: 'gt', value: '100' }, { ref: col('orders', 'order_date'), op: 'lt', value: '2024-03-01' }] });
  assert.equal(describe(question, schema), 'Number of rows in orders where status is Returned and amount is over 100 and order_date is before Mar 1, 2024');
});

test('join qualifies every column and reads naturally', () => {
  const question = q({ join: { table: 'customers', left: 'customer_id', right: 'customer_id' }, groupBy: [{ ref: col('customers', 'region') }], calc: { fn: 'sum', ref: amount }, sort: { by: 'calc', dir: 'desc' }, limit: 5 });
  assert.equal(buildSQL(question, schema), [
    'SELECT customers.region, SUM(orders.amount) AS total_amount',
    'FROM orders',
    'LEFT JOIN customers ON orders.customer_id = customers.customer_id',
    'GROUP BY customers.region',
    'ORDER BY total_amount DESC NULLS LAST',
    'LIMIT 5',
  ].join('\n'));
  assert.equal(describe(question, schema), 'Total amount by region, top 5 (orders matched to customers)');
});

test('join on columns of different types compares them as text', () => {
  const question = q({ join: { table: 'customers', left: 'order_id', right: 'customer_id' } });
  assert.match(buildSQL(question, schema), /ON CAST\(orders\.order_id AS VARCHAR\) = CAST\(customers\.customer_id AS VARCHAR\)/);
});

test('an unfinished join is left out', () => {
  assert.equal(buildSQL(q({ join: { table: 'customers', left: '', right: '' } }), schema), 'SELECT *\nFROM orders');
});

test('available comparisons depend on the type', () => {
  assert.ok(opsFor('number').includes('gt') && !opsFor('number').includes('contains'));
  assert.ok(opsFor('text').includes('contains') && !opsFor('text').includes('gt'));
  assert.deepEqual(opsFor('bool'), ['eq', 'ne', 'blank', 'not_blank']);
});

test('required columns of a question', () => {
  const question = q({ join: { table: 'customers', left: 'customer_id', right: 'customer_id' }, groupBy: [{ ref: col('customers', 'region') }], calc: { fn: 'sum', ref: amount }, filters: [{ ref: status, op: 'eq', value: 'x' }] });
  assert.deepEqual(requiredColumns(question), { orders: ['status', 'amount', 'customer_id'], customers: ['region', 'customer_id'] });
});

// ---------- join checks ----------

test('join stats: unmatched, blank, unused and repeated keys', () => {
  const stats = joinStats(['a', 'b', 'x', 'x', null, 'A'], ['a', 'b', 'b', 'c']);
  assert.deepEqual(stats, { leftRows: 6, matched: 2, unmatched: 3, blank: 1, examples: ['x', 'A'], rightUnused: 1, rightRepeated: 1 });
  const warnings = joinWarnings(stats, 'orders', 'customers');
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /3 of 6 rows in orders have no match in customers \(for example x, A\)/);
  assert.match(warnings[2], /totals may be inflated/);
});

test('join stats: numbers and text keys compare by their text', () => {
  assert.equal(joinStats([1, 2], ['1', '2']).matched, 2);
});

test('a clean join has no warnings', () => {
  assert.deepEqual(joinWarnings(joinStats(['a', 'b'], ['a', 'b']), 'l', 'r'), []);
});

// ---------- with the sample data ----------

const load = (name) => viewOf(tableFromBytes(name, `${name}.csv`, readFileSync(new URL(`../examples/${name}.csv`, import.meta.url))));
const orders = load('orders');
const customers = load('customers');
const products = load('products');

test('sample: the join column is suggested and the planted unmatched orders are reported', () => {
  assert.deepEqual(suggestJoin(orders, customers), { left: 'customer_id', right: 'customer_id' });
  assert.deepEqual(suggestJoin(orders, products), { left: 'product_id', right: 'product_id' });
  const stats = joinStats(orders.columns[2], customers.columns[0]);
  assert.equal(stats.unmatched, 5);
  assert.equal(stats.rightRepeated, 0);
});

test('sample starters only use columns that exist', () => {
  const have = { orders: orders.headers, customers: customers.headers, products: products.headers };
  for (const s of sampleStarters()) {
    for (const [table, cols] of Object.entries(requiredColumns(s.question))) {
      for (const c of cols) assert.ok(have[table].includes(c), `${s.label}: ${table}.${c}`);
    }
    assert.ok(describe(s.question).length > 5);
  }
});

test('generic starters are built from the column types', () => {
  const starters = genericStarters('orders', orders.profile);
  assert.deepEqual(starters.map((s) => s.label), ['All rows', 'Count by channel', 'Top 10 by quantity', 'Totals by month', 'Show duplicates', 'Find blanks']);
  assert.match(starters[4].sql, /GROUP BY ALL\nHAVING COUNT\(\*\) > 1/);
  assert.match(buildSQL(starters[3].question), /strftime\(order_date, '%Y-%m'\)/);
});

test('instant results: sales by month matches a hand total', () => {
  const question = sampleStarters()[0].question;
  assert.equal(canRunLocally(question), true);
  const result = runLocally(question, orders);
  assert.deepEqual(result.columns.map((c) => c.name), ['order_date_month', 'total_amount']);
  assert.equal(result.rowCount, 18);
  assert.equal(result.columns[0].values[0], '2024-01');
  const expected = orders.columns[1].reduce((sum, d, i) => sum + (d.startsWith('2024-01') ? orders.columns[5][i] : 0), 0);
  assert.ok(Math.abs(result.columns[1].values[0] - expected) < 1e-6);
  const grand = result.columns[1].values.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(grand - orders.profile.columns[5].sum) < 1e-6);
});

test('instant results: filter, group, sort and limit', () => {
  const question = { ...newQuestion('orders'), filters: [{ ref: col('orders', 'status'), op: 'eq', value: 'Returned' }, { ref: col('orders', 'amount'), op: 'gte', value: '100' }], groupBy: [{ ref: col('orders', 'channel') }], calc: { fn: 'count' }, sort: { by: 'calc', dir: 'desc' }, limit: 2 };
  const result = runLocally(question, orders);
  assert.equal(result.rowCount, 2);
  const [first, second] = result.columns[1].values;
  assert.ok(first >= second);
  let web = 0;
  for (let i = 0; i < 1500; i++) if (orders.columns[6][i] === 'Returned' && orders.columns[5][i] >= 100 && orders.columns[7][i] === result.columns[0].values[0]) web++;
  assert.equal(first, web);
});

test('instant results: plain rows, sorted and limited', () => {
  const result = runLocally({ ...newQuestion('orders'), columns: [col('orders', 'order_id'), col('orders', 'amount')], sort: { by: col('orders', 'amount'), dir: 'desc' }, limit: 3 }, orders);
  assert.equal(result.rowCount, 3);
  assert.equal(result.columns[1].values[0], orders.profile.columns[5].max);
  assert.equal(result.columns[0].unit, 'id');
});

test('instant results are not attempted for joins', () => {
  assert.equal(canRunLocally(sampleStarters()[1].question), false);
});
