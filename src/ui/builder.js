// The point-and-click question builder. It edits a question object and calls
// onChange; the SQL and sentence are produced elsewhere from that object.

import { h, replace } from './dom.js';
import { OPS, opsFor, col, sameRef, newQuestion } from '../core/sqlgen.js';
import { joinStats, joinWarnings, suggestJoin } from '../core/join.js';

const CALCS = [
  ['', 'Nothing, just list rows'],
  ['count', 'Count rows'],
  ['sum', 'Total (sum)'],
  ['avg', 'Average'],
  ['min', 'Smallest'],
  ['max', 'Largest'],
];

function distinctValues(view, column, max = 60) {
  const values = view.columns[view.headers.indexOf(column)] || [];
  const seen = new Set();
  for (const v of values) {
    if (v != null) seen.add(v);
    if (seen.size > max) return [];
  }
  return [...seen].sort();
}

// views: Map of table name -> view. onChange(question, structural).
export function renderBuilder(root, question, views, onChange) {
  const q = question;
  const tables = [...views.keys()];
  const joined = Boolean(q.join);
  const view = views.get(q.table);
  if (!view) return replace(root);

  const refs = view.headers.map((c) => col(q.table, c));
  if (joined && views.has(q.join.table)) refs.push(...views.get(q.join.table).headers.map((c) => col(q.join.table, c)));
  const typeOf = (ref) => {
    const v = views.get(ref.table);
    return v ? v.types[v.headers.indexOf(ref.column)]?.type || 'text' : 'text';
  };
  const label = (ref) => (joined ? `${ref.table}.${ref.column}` : ref.column);
  const change = (structural = true) => onChange(q, structural);

  const refSelect = (current, onPick, { types, none, name }) => {
    const options = refs.filter((r) => !types || types.includes(typeOf(r)));
    return h('select', {
      'aria-label': name,
      onchange: (e) => onPick(e.target.value === '' ? null : options[Number(e.target.value)]),
    },
      none != null && h('option', { value: '', selected: !current }, none),
      options.map((r, i) => h('option', { value: String(i), selected: sameRef(r, current) }, label(r))),
    );
  };
  const row = (name, ...content) => h('div', { class: 'b-row' }, h('span', { class: 'b-label', text: name }), h('div', { class: 'b-fields' }, content));
  const removeButton = (what, fn) => h('button', { class: 'btn quiet icon', type: 'button', 'aria-label': `Remove ${what}`, title: `Remove ${what}`, onclick: fn }, '×');

  // ----- table and join -----
  const tableRow = row('From',
    h('select', { 'aria-label': 'Table', onchange: (e) => { Object.assign(q, newQuestion(e.target.value)); change(); } },
      tables.map((t) => h('option', { value: t, selected: t === q.table }, t))),
    !joined && tables.length > 1 && h('button', { class: 'btn quiet', type: 'button', onclick: () => {
      const other = tables.find((t) => t !== q.table);
      const guess = suggestJoin(view, views.get(other)) || { left: '', right: '' };
      q.join = { table: other, ...guess };
      change();
    } }, '+ Match with another table'),
  );

  let joinRow = null;
  if (joined) {
    const otherView = views.get(q.join.table);
    const columnSelect = (headers, current, name, set) => h('select', { 'aria-label': name, onchange: (e) => { set(e.target.value); change(); } },
      h('option', { value: '', selected: !current }, 'choose…'),
      headers.map((c) => h('option', { value: c, selected: c === current }, c)));
    let warnings = [];
    if (otherView && q.join.left && q.join.right) {
      const stats = joinStats(view.columns[view.headers.indexOf(q.join.left)], otherView.columns[otherView.headers.indexOf(q.join.right)]);
      warnings = joinWarnings(stats, q.table, q.join.table);
      if (!warnings.length) warnings = [`Every row in ${q.table} has exactly one match in ${q.join.table}.`];
      else warnings.warn = true;
    }
    joinRow = row('Match with',
      h('select', { 'aria-label': 'Table to match with', onchange: (e) => {
        const guess = suggestJoin(view, views.get(e.target.value)) || { left: '', right: '' };
        Object.assign(q, { ...newQuestion(q.table), join: { table: e.target.value, ...guess } });
        change();
      } }, tables.filter((t) => t !== q.table).map((t) => h('option', { value: t, selected: t === q.join.table }, t))),
      h('span', { class: 'b-word', text: 'where' }),
      columnSelect(view.headers, q.join.left, `Column in ${q.table}`, (v) => { q.join.left = v; }),
      h('span', { class: 'b-word', text: '=' }),
      columnSelect(otherView ? otherView.headers : [], q.join.right, `Column in ${q.join.table}`, (v) => { q.join.right = v; }),
      removeButton('match', () => { Object.assign(q, newQuestion(q.table)); change(); }),
      h('ul', { class: `join-notes ${warnings.warn ? 'warn' : ''}`, role: 'status' }, warnings.map((w) => h('li', { text: w }))),
    );
  }

  // ----- calculation -----
  const fn = q.calc?.fn || '';
  const calcTypes = fn === 'min' || fn === 'max' ? ['number', 'date'] : ['number'];
  const calcRow = row('Calculate',
    h('select', { 'aria-label': 'Calculation', onchange: (e) => {
      const next = e.target.value;
      if (!next) { q.calc = null; q.groupBy = []; }
      else if (next === 'count') q.calc = { fn: 'count' };
      else {
        const keep = q.calc?.ref && typeOf(q.calc.ref) === 'number' ? q.calc.ref : refs.find((r) => typeOf(r) === 'number' && !/(^|_)id$/i.test(r.column)) || refs.find((r) => typeOf(r) === 'number');
        if (!keep) { e.target.value = fn; return; }
        q.calc = { fn: next, ref: keep };
      }
      if (q.calc) q.columns = [];
      if (!q.calc) q.sort = null;
      change();
    } }, CALCS.map(([value, text]) => h('option', { value, selected: value === fn, disabled: !['', 'count'].includes(value) && !refs.some((r) => typeOf(r) === 'number') }, text))),
    q.calc?.ref && h('span', { class: 'b-word', text: 'of' }),
    q.calc?.ref && refSelect(q.calc.ref, (r) => { q.calc.ref = r; change(); }, { types: calcTypes, name: 'Column to calculate' }),
  );

  // ----- group by -----
  const groupRow = row('For each',
    q.groupBy.map((g, i) => h('span', { class: 'b-group' },
      refSelect(g.ref, (r) => { q.groupBy[i] = { ref: r, bucket: typeOf(r) === 'date' ? 'month' : undefined }; change(); }, { name: 'Group by column' }),
      typeOf(g.ref) === 'date' && h('select', { 'aria-label': 'Date grouping', onchange: (e) => { g.bucket = e.target.value; change(); } },
        [['day', 'each date'], ['month', 'by month'], ['year', 'by year']].map(([v, t]) => h('option', { value: v, selected: (g.bucket || 'day') === v }, t))),
      removeButton('grouping', () => {
        if (q.sort && q.sort.by !== 'calc' && sameRef(q.sort.by, g.ref)) q.sort = null;
        q.groupBy.splice(i, 1);
        change();
      }),
    )),
    q.groupBy.length < 2 && h('button', { class: 'btn quiet', type: 'button', onclick: () => {
      const used = q.groupBy.map((g) => g.ref);
      const pick = refs.find((r) => ['text', 'bool'].includes(typeOf(r)) && !used.some((u) => sameRef(u, r)) && !/(^|_)id$/i.test(r.column)) || refs.find((r) => !used.some((u) => sameRef(u, r)));
      if (!pick) return;
      q.groupBy.push({ ref: pick, bucket: typeOf(pick) === 'date' ? 'month' : undefined });
      q.columns = [];
      if (!q.calc) q.calc = { fn: 'count' };
      if (!q.sort || (q.sort.by !== 'calc' && !q.groupBy.some((g) => sameRef(g.ref, q.sort.by)))) q.sort = { by: 'calc', dir: 'desc' };
      change();
    } }, q.groupBy.length ? '+ and by' : '+ Group by a column'),
  );

  // ----- filters -----
  const filterRows = q.filters.map((f, i) => {
    const type = typeOf(f.ref);
    const ops = opsFor(type);
    let valueInput = null;
    if (!OPS[f.op].noValue) {
      const set = (e) => { f.value = e.target.value; change(false); };
      if (type === 'bool') {
        valueInput = h('select', { 'aria-label': 'Value', onchange: set }, [['yes', 'Yes'], ['no', 'No']].map(([v, t]) => h('option', { value: v, selected: f.value === v }, t)));
      } else if (type === 'date') {
        valueInput = h('input', { type: 'date', 'aria-label': 'Date', value: f.value || '', oninput: set });
      } else {
        const choices = type === 'text' ? distinctValues(views.get(f.ref.table), f.ref.column) : [];
        const listId = `values-${i}`;
        valueInput = h('span', {},
          h('input', { type: 'text', 'aria-label': 'Value', placeholder: type === 'number' ? 'a number' : 'a value', inputmode: type === 'number' ? 'decimal' : null, list: choices.length ? listId : null, value: f.value ?? '', oninput: set }),
          choices.length ? h('datalist', { id: listId }, choices.map((v) => h('option', { value: v }))) : null,
        );
      }
    }
    return h('div', { class: 'b-filter' },
      refSelect(f.ref, (r) => {
        const t = typeOf(r);
        q.filters[i] = { ref: r, op: opsFor(t).includes(f.op) ? f.op : 'eq', value: t === 'bool' ? 'yes' : '' };
        change();
      }, { name: 'Filter column' }),
      h('select', { 'aria-label': 'Comparison', onchange: (e) => { f.op = e.target.value; change(); } },
        ops.map((op) => h('option', { value: op, selected: op === f.op }, OPS[op].label))),
      valueInput,
      removeButton('filter', () => { q.filters.splice(i, 1); change(); }),
    );
  });
  const filterRow = row('Only where',
    filterRows,
    h('button', { class: 'btn quiet', type: 'button', onclick: () => {
      const first = refs.find((r) => typeOf(r) === 'text' && !/(^|_)id$/i.test(r.column)) || refs[0];
      q.filters.push({ ref: first, op: 'eq', value: typeOf(first) === 'bool' ? 'yes' : '' });
      change();
    } }, q.filters.length ? '+ and' : '+ Add a filter'),
  );

  // ----- columns to show -----
  const plain = !q.calc && !q.groupBy.length;
  const columnsRow = plain && row('Show',
    h('details', { class: 'b-columns' },
      h('summary', { text: q.columns.length ? `${q.columns.length} of ${refs.length} columns` : 'All columns' }),
      h('div', { class: 'b-checks' }, refs.map((r) => h('label', {},
        h('input', { type: 'checkbox', checked: q.columns.some((c) => sameRef(c, r)), onchange: (e) => {
          if (e.target.checked) q.columns = refs.filter((x) => sameRef(x, r) || q.columns.some((c) => sameRef(c, x)));
          else q.columns = q.columns.filter((c) => !sameRef(c, r));
          e.target.closest('details').querySelector('summary').textContent = q.columns.length ? `${q.columns.length} of ${refs.length} columns` : 'All columns';
          change(false);
        } }),
        ' ', label(r)))),
    ),
  );

  // ----- sort and limit -----
  const sortChoices = [];
  if (q.calc || q.groupBy.length) {
    sortChoices.push({ by: 'calc', text: 'the calculated value' });
    for (const g of q.groupBy) sortChoices.push({ by: g.ref, text: label(g.ref) });
  } else {
    for (const r of refs) sortChoices.push({ by: r, text: label(r) });
  }
  const sortIndex = q.sort ? sortChoices.findIndex((c) => (c.by === 'calc' ? q.sort.by === 'calc' : q.sort.by !== 'calc' && sameRef(c.by, q.sort.by))) : -1;
  const sortType = q.sort && q.sort.by !== 'calc' ? typeOf(q.sort.by) : 'number';
  const dirWords = sortType === 'date' ? ['oldest first', 'newest first'] : sortType === 'number' ? ['smallest first', 'biggest first'] : ['A to Z', 'Z to A'];
  const sortRow = row('Sort by',
    h('select', { 'aria-label': 'Sort by', onchange: (e) => {
      q.sort = e.target.value === '' ? null : { by: sortChoices[Number(e.target.value)].by, dir: q.sort?.dir || 'desc' };
      change();
    } },
      h('option', { value: '', selected: sortIndex === -1 }, 'no particular order'),
      sortChoices.map((c, i) => h('option', { value: String(i), selected: i === sortIndex }, c.text))),
    sortIndex !== -1 && h('select', { 'aria-label': 'Direction', onchange: (e) => { q.sort.dir = e.target.value; change(false); } },
      h('option', { value: 'asc', selected: q.sort.dir !== 'desc' }, dirWords[0]),
      h('option', { value: 'desc', selected: q.sort.dir === 'desc' }, dirWords[1])),
    h('span', { class: 'b-word', text: 'keep' }),
    h('input', { type: 'number', class: 'b-limit', min: '1', step: '1', placeholder: 'all', 'aria-label': 'Maximum number of rows', value: q.limit ?? '', oninput: (e) => {
      const n = Math.floor(Number(e.target.value));
      q.limit = n > 0 ? n : null;
      change(false);
    } }),
    h('span', { class: 'b-word', text: 'rows' }),
  );

  replace(root, tableRow, joinRow, calcRow, groupRow, filterRow, columnsRow, sortRow);
}

// Drops parts of a question that refer to tables or columns that no longer exist.
export function repairQuestion(q, views) {
  if (!views.has(q.table)) return null;
  const ok = (ref) => Boolean(ref) && views.has(ref.table) && views.get(ref.table).headers.includes(ref.column) && (ref.table === q.table || ref.table === q.join?.table);
  if (q.join && (!views.has(q.join.table) || !ok(col(q.table, q.join.left)) || !ok(col(q.join.table, q.join.right)))) q.join = null;
  q.columns = q.columns.filter(ok);
  q.filters = q.filters.filter((f) => ok(f.ref));
  q.groupBy = q.groupBy.filter((g) => ok(g.ref));
  if (q.calc?.ref && !ok(q.calc.ref)) q.calc = q.groupBy.length ? { fn: 'count' } : null;
  if (q.sort && q.sort.by !== 'calc' && !ok(q.sort.by)) q.sort = null;
  return q;
}
