import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, toDelimited } from '../src/core/csv.js';

test('parses plain rows', () => {
  assert.deepEqual(parseDelimited('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('keeps separators and line breaks inside quotes', () => {
  assert.deepEqual(parseDelimited('name,note\n"Smith, J","line one\nline two"\n'), [
    ['name', 'note'],
    ['Smith, J', 'line one\nline two'],
  ]);
});

test('un-doubles quotes', () => {
  assert.deepEqual(parseDelimited('"say ""hi""",x'), [['say "hi"', 'x']]);
});

test('handles \\r\\n, empty fields and a trailing separator', () => {
  assert.deepEqual(parseDelimited('a,,c\r\n1,2,\r\n'), [['a', '', 'c'], ['1', '2', '']]);
});

test('keeps blank lines as rows so they can be reported', () => {
  assert.deepEqual(parseDelimited('a\n\nb'), [['a'], [''], ['b']]);
});

test('other separators', () => {
  assert.deepEqual(parseDelimited('a;b\n"x;y";2', ';'), [['a', 'b'], ['x;y', '2']]);
  assert.deepEqual(parseDelimited('a\tb', '\t'), [['a', 'b']]);
});

test('stops at maxRows', () => {
  assert.equal(parseDelimited('1\n2\n3\n4', ',', 2).length, 2);
});

test('writing then reading gives the same rows', () => {
  const rows = [['plain', 'with, comma', 'with "quote"', 'two\nlines']];
  const text = toDelimited(['a', 'b', 'c', 'd'], rows);
  assert.deepEqual(parseDelimited(text).slice(1), rows);
});
