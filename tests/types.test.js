import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseDate, parseBool, detectDecimal, detectDateOrder, guessType, typeFor, convert, isBlank } from '../src/core/types.js';

test('numbers: plain, currency, thousands, percent, negatives', () => {
  assert.equal(parseNumber('42'), 42);
  assert.equal(parseNumber('-3.5'), -3.5);
  assert.equal(parseNumber('$1,200'), 1200);
  assert.equal(parseNumber('$1,200.50'), 1200.5);
  assert.equal(parseNumber('-$5'), -5);
  assert.equal(parseNumber('$-5'), -5);
  assert.equal(parseNumber('(300)'), -300);
  assert.equal(parseNumber('45%'), 45);
  assert.equal(parseNumber('1 200'), 1200);
  assert.equal(parseNumber('€ 99'), 99);
  assert.equal(parseNumber('12 USD'), 12);
  assert.equal(parseNumber('.5'), 0.5);
  assert.equal(parseNumber('1e3'), 1000);
});

test('numbers: European format', () => {
  assert.equal(parseNumber('1.000,50', ','), 1000.5);
  assert.equal(parseNumber('1.250,00 €', ','), 1250);
  assert.equal(parseNumber('3,5', ','), 3.5);
  assert.equal(parseNumber('2.000.000', ','), 2000000);
});

test('numbers: rejects things that are not numbers', () => {
  for (const v of ['', 'abc', '12abc', '1,2,3', '1.2.3', '--', '$', 'twelve', '2024-01-05', '12,34.5']) {
    assert.equal(parseNumber(v), null, v);
  }
});

test('decimal sign is worked out per column', () => {
  assert.equal(detectDecimal(['1.000,50', '20,00']), ',');
  assert.equal(detectDecimal(['1,000.50', '20.00']), '.');
  assert.equal(detectDecimal(['1,5', '2,25']), ',');
  assert.equal(detectDecimal(['1,200', '3,400']), '.'); // could be either: assume thousands
  assert.equal(detectDecimal(['1.200.300']), ',');
});

test('dates: ISO and written-out forms', () => {
  assert.equal(parseDate('2024-03-09'), '2024-03-09');
  assert.equal(parseDate('2024/3/9'), '2024-03-09');
  assert.equal(parseDate('2024-03-09T14:05:00Z'), '2024-03-09 14:05:00');
  assert.equal(parseDate('Jan 5, 2024'), '2024-01-05');
  assert.equal(parseDate('January 5 2024'), '2024-01-05');
  assert.equal(parseDate('5 Jan 2024'), '2024-01-05');
  assert.equal(parseDate('5-Jan-24'), '2024-01-05');
  assert.equal(parseDate('3rd March 2021'), '2021-03-03');
});

test('dates: month-first and day-first', () => {
  assert.equal(parseDate('3/4/2024', 'MDY'), '2024-03-04');
  assert.equal(parseDate('3/4/2024', 'DMY'), '2024-04-03');
  assert.equal(parseDate('14.01.2025', 'DMY'), '2025-01-14');
  assert.equal(parseDate('1/2/99', 'MDY'), '1999-01-02');
  assert.equal(parseDate('1/2/24 3:30 pm', 'MDY'), '2024-01-02 15:30:00');
});

test('dates: rejects impossible or non-dates', () => {
  for (const v of ['31/02/2024', '13/13/2024', '2024-13-01', 'Foo 5, 2024', '12345', '1.5', 'hello', '2023-02-29']) {
    assert.equal(parseDate(v, 'DMY'), null, v);
  }
  assert.equal(parseDate('2024-02-29'), '2024-02-29');
});

test('date order is worked out from unambiguous values', () => {
  assert.deepEqual(detectDateOrder(['01/02/2024', '25/02/2024']), { order: 'DMY', ambiguous: false });
  assert.deepEqual(detectDateOrder(['01/02/2024', '02/25/2024']), { order: 'MDY', ambiguous: false });
  assert.deepEqual(detectDateOrder(['01/02/2024', '03/04/2024']), { order: 'MDY', ambiguous: true });
  assert.deepEqual(detectDateOrder(['2024-01-02']), { order: 'MDY', ambiguous: false });
});

test('yes/no', () => {
  assert.equal(parseBool('Yes'), true);
  assert.equal(parseBool('n'), false);
  assert.equal(parseBool('TRUE'), true);
  assert.equal(parseBool('maybe'), null);
});

test('blank markers', () => {
  for (const v of ['', '  ', 'N/A', 'null', '-', null, undefined]) assert.equal(isBlank(v), true);
  for (const v of ['0', 'None', 'no']) assert.equal(isBlank(v), false);
});

test('guess: column types', () => {
  assert.equal(guessType(['1', '2', '3.5']).type, 'number');
  assert.deepEqual(guessType(['$1,200', '$300', '$45.10']), { type: 'number', decimal: '.', unit: '$' });
  assert.deepEqual(guessType(['45%', '3%', '']), { type: 'number', decimal: '.', unit: '%' });
  assert.equal(guessType(['1.000,50', '2,25', '300']).decimal, ',');
  assert.equal(guessType(['yes', 'No', 'YES', '']).type, 'bool');
  assert.equal(guessType(['apple', 'pear']).type, 'text');
  assert.equal(guessType(['', 'N/A']).type, 'text');
});

test('guess: dates carry their order and whether it was a coin toss', () => {
  const dmy = guessType(['25/12/2024', '01/02/2024']);
  assert.equal(dmy.type, 'date');
  assert.equal(dmy.order, 'DMY');
  assert.equal(dmy.ambiguous, false);
  assert.equal(guessType(['01/02/2024', '03/04/2024']).ambiguous, true);
  assert.equal(guessType(['2024-01-05 10:00:00']).hasTime, true);
});

test('guess: a few bad values do not change the type', () => {
  const values = [...Array(20).keys()].map(String).concat(['n/a', 'oops']);
  assert.equal(guessType(values).type, 'number');
});

test('guess: codes with leading zeros stay text', () => {
  assert.equal(guessType(['00123', '04567', '10001']).type, 'text');
});

test('convert uses the column type; misfits become null', () => {
  const num = guessType(['1.000,50', '2,5']);
  assert.equal(convert('1.000,50', num), 1000.5);
  assert.equal(convert('oops', num), null);
  assert.equal(convert('n/a', num), null);
  assert.equal(convert(' hi ', { type: 'text' }), 'hi');
  assert.equal(convert('Yes', { type: 'bool' }), true);
});

test('choosing a type by hand', () => {
  assert.equal(typeFor(['01/02/2024'], 'date', 'DMY').order, 'DMY');
  assert.equal(convert('01/02/2024', typeFor(['01/02/2024'], 'date', 'DMY')), '2024-02-01');
  assert.equal(convert('00123', typeFor(['00123'], 'number')), 123);
  assert.equal(convert('2024', typeFor(['2024'], 'text')), '2024');
});
