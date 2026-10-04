// Checks the colour tokens in styles.css against WCAG AA (4.5:1 for text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function tokens(selector) {
  const start = css.indexOf(selector + ' {');
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [text colour, background it is used on]
const PAIRS = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink', 'sunken'], ['ink', 'warn-soft'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'sunken'],
  ['accent', 'surface'], ['accent', 'accent-soft'], ['accent', 'bg'], ['accent-ink', 'accent'],
  ['warn', 'warn-soft'], ['warn', 'surface'], ['danger', 'surface'],
  ['kw', 'sunken'], ['str', 'sunken'], ['num', 'sunken'], ['com', 'sunken'],
  ['surface', 'ink'],
];

for (const [name, selector] of [['light', ':root'], ['dark', ':root[data-theme="dark"]']]) {
  test(`${name} theme text contrast is at least 4.5:1`, () => {
    const t = tokens(selector);
    for (const [fg, bg] of PAIRS) {
      assert.ok(t[fg] && t[bg], `missing token ${fg} or ${bg}`);
      const ratio = contrast(t[fg], t[bg]);
      assert.ok(ratio >= 4.5, `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}
