// SQL editor: a textarea with a highlighted copy of its text drawn underneath,
// plus a list of tables and columns that insert their names when clicked.

import { h, replace } from './dom.js';
import { tokenize } from '../core/highlight.js';
import { ident } from '../core/sqlgen.js';

export function highlightInto(target, sql, mark = null) {
  // mark = { line, column } puts an error marker on that character.
  let offset = -1;
  if (mark && mark.line) {
    const lines = sql.split('\n');
    offset = lines.slice(0, mark.line - 1).reduce((n, l) => n + l.length + 1, 0) + (mark.column || 0);
  }
  const nodes = [];
  let pos = 0;
  for (const token of tokenize(sql)) {
    const end = pos + token.text.length;
    const node = token.type === 'ws' || token.type === 'punct' || token.type === 'ident'
      ? document.createTextNode(token.text)
      : h('span', { class: `t-${token.type}`, text: token.text });
    nodes.push(offset >= pos && offset < end && token.type !== 'ws' ? h('mark', { class: 'err-mark' }, node) : node);
    pos = end;
  }
  nodes.push(document.createTextNode('\n')); // keeps the last empty line visible
  target.replaceChildren(...nodes);
}

export function createEditor(root, { onRun }) {
  const code = h('code');
  const pre = h('pre', { class: 'editor-hl', 'aria-hidden': 'true' }, code);
  const area = h('textarea', {
    class: 'editor-input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
    'aria-label': 'SQL', rows: '8',
  });
  const schema = h('div', { class: 'schema', 'aria-label': 'Tables and columns. Click a name to insert it.' });
  const errorBox = h('div', { class: 'sql-error', role: 'alert', hidden: true });
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const runButton = h('button', { class: 'btn primary', type: 'button', onclick: () => onRun(area.value) }, 'Run ', h('kbd', { text: mac ? '⌘↵' : 'Ctrl+Enter' }));

  let mark = null;
  const paint = () => highlightInto(code, area.value, mark);
  area.addEventListener('input', () => { mark = null; errorBox.hidden = true; paint(); });
  area.addEventListener('scroll', () => { pre.scrollTop = area.scrollTop; pre.scrollLeft = area.scrollLeft; });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onRun(area.value); }
  });

  function insert(text) {
    const before = area.value.slice(0, area.selectionStart);
    const pad = before && !/[\s(.,]$/.test(before) ? ' ' : '';
    area.setRangeText(pad + text, area.selectionStart, area.selectionEnd, 'end');
    area.focus();
    area.dispatchEvent(new Event('input'));
  }

  replace(root,
    h('div', { class: 'editor-wrap' },
      h('div', { class: 'editor' }, pre, area),
      schema,
    ),
    h('div', { class: 'editor-actions' }, runButton, h('span', { class: 'hint', text: 'Click a table or column name to insert it.' })),
    errorBox,
  );
  paint();

  return {
    get value() { return area.value; },
    set(sql) { area.value = sql; mark = null; errorBox.hidden = true; paint(); },
    focus() { area.focus(); },
    setSchema(views) {
      replace(schema, [...views].map(([name, view]) => h('div', { class: 'schema-table' },
        h('button', { class: 'schema-name', type: 'button', title: `Insert ${name}`, onclick: () => insert(ident(name)) }, name),
        h('div', { class: 'schema-cols' }, view.headers.map((c, i) => h('button', {
          class: 'chip', type: 'button', title: `${view.types[i].type} column. Click to insert.`, onclick: () => insert(ident(c)),
        }, c))),
      )));
    },
    showError(info) {
      mark = info.line ? { line: info.line, column: info.column } : null;
      paint();
      replace(errorBox,
        h('strong', { text: info.title + (info.line ? ` (line ${info.line}, character ${info.column + 1})` : '') }),
        h('p', { class: 'err-detail', text: info.detail }),
        info.hint && h('p', { text: info.hint }),
      );
      errorBox.hidden = false;
    },
    clearError() { mark = null; errorBox.hidden = true; paint(); },
  };
}
