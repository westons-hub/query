// The "Your data" panel: table tabs, the summary of the selected table, and the
// problems found in it with their one-click fixes.

import { h, replace } from './dom.js';
import { fmtCount, fmtNumber, fmtDate, fmtValue, plural } from '../core/format.js';

const TYPE_OPTIONS = [
  ['number', 'Number'],
  ['date:MDY', 'Date (month first)'],
  ['date:DMY', 'Date (day first)'],
  ['text', 'Text'],
  ['bool', 'Yes / No'],
];

const STEP_LABELS = {
  remove_blank_rows: () => 'Removed blank rows',
  remove_duplicates: () => 'Removed duplicate rows',
  remove_rows: () => 'Removed totals row',
  blank_values: (s) => `Blanked values that did not fit “${s.column}”`,
  replace_values: (s) => `Made spellings in “${s.column}” consistent`,
};

function fileNotes(table) {
  const { notes } = table;
  const parts = [];
  if (notes.sheet) parts.push(`Sheet “${notes.sheet}”`);
  if (notes.separator) parts.push(`${notes.separator}-separated, ${notes.encoding}`);
  if (notes.skipped?.length) parts.push(`skipped ${plural(notes.skipped.length, 'line')} of notes above the header`);
  if (!notes.hasHeader) parts.push('no header row found, so columns were numbered');
  return parts.join(' · ');
}

function columnCard(col, info, table, actions) {
  const selected = info.type === 'date' ? `date:${info.order}` : info.type;
  const select = h('select', {
    class: `type-select type-${info.type}`,
    'aria-label': `Type of ${col.name}`,
    onchange: (e) => {
      const [type, order] = e.target.value.split(':');
      actions.setType(table, col.name, { type, order });
    },
  }, TYPE_OPTIONS.map(([value, label]) => h('option', { value, selected: value === selected }, label)));

  const facts = [];
  if (info.type === 'number' && col.filled && col.unit !== 'id') {
    facts.push(['Min', fmtNumber(col.min, col.unit)], ['Average', fmtNumber(col.mean, col.unit)], ['Max', fmtNumber(col.max, col.unit)]);
  } else if (info.type === 'date' && col.filled) {
    facts.push(['From', fmtDate(col.min)], ['To', fmtDate(col.max)]);
  }

  const showTop = col.filled > 0 && (info.type === 'text' || info.type === 'bool' || col.distinct <= 8) && col.distinct < col.filled;
  const top = showTop && h('ul', { class: 'top-values' }, col.top.slice(0, 4).map((t) =>
    h('li', {},
      h('span', { class: 'top-label', text: fmtValue(t.value, info.type, col.unit) }),
      h('span', { class: 'top-pct', text: `${t.pct < 1 ? '<1' : Math.round(t.pct)}%` }),
      h('span', { class: 'top-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.max(t.pct, 1)}%` } })),
    )));

  return h('li', { class: 'column' },
    h('div', { class: 'column-top' },
      h('span', { class: 'column-name', text: col.name, title: col.name }),
      select,
    ),
    info.type === 'date' && info.ambiguous && h('p', { class: 'hint' },
      'Could be day-first or month-first. Read as month-first. ',
      h('button', { class: 'link', type: 'button', onclick: () => actions.setType(table, col.name, { type: 'date', order: 'DMY' }) }, 'Switch to day-first'),
    ),
    h('p', { class: 'column-counts' },
      `${fmtCount(col.distinct)} distinct`,
      col.blanks ? h('span', { class: 'blank-count' }, ` · ${plural(col.blanks, 'blank')}`) : ' · no blanks',
      col.distinct === col.filled && col.filled > 1 ? ' · all unique' : '',
    ),
    facts.length ? h('dl', { class: 'facts' }, facts.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))) : null,
    top,
  );
}

function problemItem(problem, table, actions) {
  const preview = h('table', { class: 'preview', hidden: true },
    h('thead', {}, h('tr', {}, h('th', { text: 'Now' }), h('th', { text: 'After the fix' }))),
    h('tbody', {}, problem.examples.map((ex) => h('tr', {}, h('td', { text: ex.before }), h('td', { text: ex.after })))),
    problem.count > problem.examples.length && h('caption', { text: `Showing ${problem.examples.length} of ${fmtCount(problem.count)}` }),
  );
  const toggle = h('button', { class: 'btn quiet', type: 'button', 'aria-expanded': 'false', onclick: () => {
    preview.hidden = !preview.hidden;
    toggle.setAttribute('aria-expanded', String(!preview.hidden));
    toggle.textContent = preview.hidden ? 'Preview' : 'Hide preview';
  } }, 'Preview');
  return h('li', { class: 'problem' },
    h('div', { class: 'problem-text' },
      h('strong', { text: problem.title }),
      h('span', { text: problem.detail }),
    ),
    h('div', { class: 'problem-actions' },
      toggle,
      h('button', { class: 'btn', type: 'button', onclick: () => actions.fix(table, [problem.step]) }, problem.fixLabel),
    ),
    preview,
  );
}

export function renderDataPanel(root, state, actions) {
  const table = state.tables.find((t) => t.name === state.active);
  if (!table) return replace(root, h('p', { class: 'empty', text: 'Drop a CSV or Excel file anywhere on this page to begin.' }));
  const view = state.views.get(table.name);
  const { profile, problems } = view;

  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Tables' }, state.tables.map((t) =>
    h('button', {
      class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(t.name === table.name),
      onclick: () => actions.select(t.name),
    }, t.name, state.views.get(t.name).problems.length ? h('span', { class: 'dot', title: 'Has problems to review' }) : null)));

  const summary = h('section', { class: 'summary', 'aria-label': `Summary of ${table.name}` },
    h('div', { class: 'summary-head' },
      h('h3', {}, h('span', { class: 'big', text: fmtCount(profile.rowCount) }), ' rows ', h('span', { class: 'big', text: profile.colCount }), ' columns'),
      state.sample ? null : h('button', { class: 'btn quiet', type: 'button', onclick: () => actions.remove(table.name), 'aria-label': `Remove ${table.name}` }, 'Remove'),
    ),
    h('p', { class: 'file-notes' }, h('span', { class: 'file-name', text: table.source }), ' ', fileNotes(table)),
  );

  const problemsBox = h('section', { class: `problems ${problems.length ? 'has' : 'none'}`, 'aria-label': 'Problems' },
    h('div', { class: 'problems-head' },
      h('h3', { text: problems.length ? `${plural(problems.length, 'thing')} to check` : 'No problems found' }),
      problems.length > 1 && h('button', { class: 'btn', type: 'button', onclick: () => actions.fixAll(table) }, 'Fix all'),
    ),
    problems.length
      ? h('ul', { class: 'problem-list' }, problems.map((p) => problemItem(p, table, actions)))
      : h('p', { class: 'hint', text: table.recipe.length ? 'Everything below has been cleaned up.' : 'Checked for duplicates, blank rows, a totals row, values that do not fit their column, and inconsistent spellings.' }),
    table.recipe.length ? h('div', { class: 'applied' },
      h('h4', { text: 'Fixes applied' }),
      h('ol', {}, table.recipe.map((step, i) => h('li', {},
        STEP_LABELS[step.op](step),
        i === table.recipe.length - 1 && h('button', { class: 'link', type: 'button', onclick: () => actions.undo(table) }, 'Undo'),
      ))),
      h('p', { class: 'hint', text: 'Fixes apply to the copy in this page. Your file is not changed.' }),
    ) : null,
  );

  const columns = h('ul', { class: 'columns' }, profile.columns.map((col, i) => columnCard(col, view.types[i], table, actions)));

  replace(root, tabs, summary, problemsBox, h('h3', { class: 'columns-title', text: 'Columns' }), columns);
}
