// Turns a database error into something a person can act on: a plain message,
// where in the SQL it happened, and a hint.

const KINDS = {
  Parser: 'The SQL could not be read',
  Binder: 'Something in the SQL does not exist',
  Catalog: 'Something in the SQL does not exist',
  Conversion: 'A value could not be converted',
  'Invalid Input': 'A value was not valid',
  'Out of Range': 'A number was out of range',
};

function locate(message, sql) {
  // DuckDB adds:  LINE 2: FORM orders
  //                       ^
  const m = /LINE (\d+): ([^\n]*)\n(\s*)\^/.exec(message);
  if (!m) return null;
  const line = Number(m[1]);
  const shown = m[2];
  const caret = m[3].length - `LINE ${m[1]}: `.length;
  const source = sql.split('\n')[line - 1] ?? '';
  if (!shown.startsWith('...')) return { line, column: Math.max(0, Math.min(caret, source.length)) };
  // Long lines are shown clipped; find the clipped piece in the real line.
  const piece = shown.replace(/^\.\.\.|\.\.\.$/g, '');
  const at = source.indexOf(piece);
  return { line, column: at === -1 ? 0 : Math.max(0, at + caret - 3) };
}

export function explainError(error, sql = '', tables = {}) {
  const raw = String(error?.message ?? error).replace(/^Error:\s*/, '');
  const kindMatch = /^([A-Z][A-Za-z ]+?) Error:\s*/.exec(raw);
  const kind = kindMatch ? kindMatch[1] : '';
  const body = raw.slice(kindMatch ? kindMatch[0].length : 0);
  const detail = body.split(/\n\s*LINE \d+:/)[0].replace(/\s+/g, ' ').trim();
  const where = locate(raw, sql);
  const tableNames = Object.keys(tables);
  let hint = '';
  let m;

  if ((m = /Table with name "?([^\s"!]+)"? does not exist/i.exec(body))) {
    const guess = /Did you mean "([^"]+)"/.exec(body);
    hint = `There is no table called ${m[1]}.` + (guess ? ` Did you mean ${guess[1].split('.').pop()}?` : '')
      + (tableNames.length ? ` Tables you can use: ${tableNames.join(', ')}.` : '');
  } else if ((m = /Referenced column "([^"]+)" not found/i.exec(body))) {
    const candidates = /Candidate bindings: (.*)/.exec(body);
    hint = `There is no column called ${m[1]}.` + (candidates ? ` Closest matches: ${candidates[1].replace(/"/g, '').trim()}.` : '')
      + ' Click a column name on the right to insert it exactly.';
  } else if (/must appear in the GROUP BY clause/i.test(body)) {
    hint = 'When you group, every column in SELECT must either be listed in GROUP BY or be inside a calculation such as SUM() or COUNT().';
  } else if ((m = /syntax error at or near "([^"]*)"/i.exec(body))) {
    hint = `The SQL stops making sense at “${m[1]}”. Look for a typo, a missing comma, or an unclosed quote just before it.`;
  } else if (/syntax error at end of input/i.test(body)) {
    hint = 'The SQL ends too early. Something is missing at the end, such as a table name or a closing bracket.';
  } else if (kind === 'Conversion') {
    hint = 'A column holds text where a number or date was expected. Check the column type in the data panel, or compare it with a quoted value.';
  } else if (/No function matches/i.test(body)) {
    hint = 'That function cannot be used on this kind of column. For example, SUM needs a number column.';
  }

  return { title: KINDS[kind] || 'The query could not be run', detail, hint, line: where?.line ?? null, column: where?.column ?? null };
}
