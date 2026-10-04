import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBytes, detectSeparator, detectHeader } from '../src/core/detect.js';
import { parseDelimited } from '../src/core/csv.js';

const grid = (text, sep = ',') => parseDelimited(text, sep);

test('separator: comma, semicolon, tab, pipe', () => {
  assert.equal(detectSeparator('a,b,c\n1,2,3\n4,5,6'), ',');
  assert.equal(detectSeparator('a;b;c\n1;2;3\n4;5;6'), ';');
  assert.equal(detectSeparator('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectSeparator('a|b|c\n1|2|3'), '|');
});

test('separator: semicolons win when numbers contain commas', () => {
  assert.equal(detectSeparator('name;price;cost\nx;1,50;2,75\ny;3,25;4,10\nz;5,00;1,20'), ';');
});

test('separator: commas inside quotes do not count', () => {
  assert.equal(detectSeparator('name;note\n"a, b, c, d";1\n"e, f, g, h";2'), ';');
});

test('separator: ignores a few notes lines above the table', () => {
  assert.equal(detectSeparator('Report for March, April, May and June\n\na;b;c\n1;2;3\n4;5;6\n7;8;9'), ';');
});

test('separator: single column falls back to comma', () => {
  assert.equal(detectSeparator('name\nalpha\nbeta'), ',');
});

test('header: first row by default', () => {
  const h = detectHeader(grid('id,name\n1,a\n2,b'));
  assert.deepEqual(h.headers, ['id', 'name']);
  assert.equal(h.headerIndex, 0);
  assert.equal(h.rows.length, 2);
});

test('header: skips title and notes lines', () => {
  const h = detectHeader(grid('Quarterly report\nExported on 5 May\n\nid,name,amount\n1,a,10\n2,b,20'));
  assert.equal(h.headerIndex, 3);
  assert.deepEqual(h.headers, ['id', 'name', 'amount']);
  assert.deepEqual(h.skipped, ['Quarterly report', 'Exported on 5 May']);
  assert.deepEqual(h.rows, [['1', 'a', '10'], ['2', 'b', '20']]);
});

test('header: a notes line with a couple of commas is still skipped', () => {
  const h = detectHeader(grid('Sales, all regions\nid,name,amount,region,rep\n1,a,10,N,x\n2,b,20,S,y'));
  assert.equal(h.headerIndex, 1);
});

test('header: file with no header gets column names', () => {
  const h = detectHeader(grid('1,apple,2.5\n2,pear,3.1'));
  assert.equal(h.hasHeader, false);
  assert.deepEqual(h.headers, ['column_1', 'column_2', 'column_3']);
  assert.equal(h.rows.length, 2);
});

test('header: blank and repeated names are made unique', () => {
  const h = detectHeader(grid('name,,name\na,b,c'));
  assert.deepEqual(h.headers, ['name', 'column_2', 'name_2']);
});

test('header: short rows are padded, blank rows are kept', () => {
  const h = detectHeader(grid('a,b,c\n1\n\n4,5,6'));
  assert.deepEqual(h.rows, [['1', '', ''], ['', '', ''], ['4', '5', '6']]);
});

test('encoding: UTF-8 with and without BOM', () => {
  const plain = new TextEncoder().encode('café');
  assert.deepEqual(decodeBytes(plain), { text: 'café', encoding: 'UTF-8' });
  assert.equal(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...plain])).text, 'café');
});

test('encoding: falls back to Windows-1252', () => {
  // "café €" as Excel on Windows would save it
  const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]);
  assert.deepEqual(decodeBytes(bytes), { text: 'café €', encoding: 'Windows-1252' });
});

test('encoding: UTF-16 with BOM', () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]);
  assert.equal(decodeBytes(bytes).text, 'a,b');
});
