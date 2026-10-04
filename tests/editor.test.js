import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, tablesIn } from '../src/core/highlight.js';
import { explainError } from '../src/core/errors.js';

test('highlighting never changes the text', () => {
  for (const sql of ["SELECT a, 'it''s' FROM \"my table\" -- note\nWHERE x >= 1.5e3 /* c */", "select 'unclosed", '', '  \n\t']) {
    assert.equal(tokenize(sql).map((t) => t.text).join(''), sql);
  }
});

test('highlighting: token kinds', () => {
  const kinds = tokenize("SELECT SUM(amount) AS t, 'x' FROM orders WHERE n > 10 -- hi").filter((t) => t.type !== 'ws').map((t) => `${t.type}:${t.text}`);
  assert.deepEqual(kinds, ['kw:SELECT', 'fn:SUM', 'punct:(', 'ident:amount', 'punct:)', 'kw:AS', 'ident:t', 'punct:,', "str:'x'", 'kw:FROM', 'ident:orders', 'kw:WHERE', 'ident:n', 'punct:>', 'num:10', 'com:-- hi']);
});

test('tables mentioned in SQL', () => {
  assert.deepEqual(tablesIn('select * from orders o join "my table" m on 1=1 left join orders x on 1=1'), ['orders', 'my table']);
});

// Messages below are as DuckDB-WASM reports them.
test('errors: syntax error points at the place', () => {
  const e = explainError(new Error('Parser Error: syntax error at or near "orders"\n\nLINE 1: SELECT * FORM orders\n                      ^'), 'SELECT * FORM orders');
  assert.equal(e.title, 'The SQL could not be read');
  assert.equal(e.detail, 'syntax error at or near "orders"');
  assert.deepEqual([e.line, e.column], [1, 14]);
  assert.match(e.hint, /stops making sense at “orders”/);
});

test('errors: position on a later line', () => {
  const sql = 'SELECT *\nFROM orders\nWHERE nope = 1';
  const e = explainError(new Error('Binder Error: Referenced column "nope" not found in FROM clause!\nCandidate bindings: "order_id", "order_date"\n\nLINE 3: WHERE nope = 1\n              ^'), sql);
  assert.deepEqual([e.line, e.column], [3, 6]);
  assert.match(e.hint, /no column called nope.*Closest matches: order_id, order_date/);
});

test('errors: unknown table suggests the right one', () => {
  const e = explainError(new Error('Catalog Error: Table with name ordrs does not exist!\nDid you mean "orders"?\n\nLINE 1: SELECT * FROM ordrs\n                      ^'), 'SELECT * FROM ordrs', { orders: {}, customers: {} });
  assert.match(e.hint, /no table called ordrs\. Did you mean orders\? Tables you can use: orders, customers\./);
  assert.equal(e.column, 14);
});

test('errors: group by', () => {
  const e = explainError(new Error('Binder Error: column "status" must appear in the GROUP BY clause or must be part of an aggregate function.'), '');
  assert.match(e.hint, /every column in SELECT/);
  assert.equal(e.line, null);
});

test('errors: anything else still gets a readable message', () => {
  const e = explainError('something odd happened');
  assert.equal(e.title, 'The query could not be run');
  assert.equal(e.detail, 'something odd happened');
});
