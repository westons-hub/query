// Splits SQL into coloured pieces for the editor. Joining every piece's text
// gives back the input exactly.

const KEYWORDS = new Set(('select from where group by order having limit offset join left right inner outer full cross on as and or not '
  + 'in is null like ilike between case when then else end distinct union all asc desc with over partition using exists '
  + 'true false cast nulls first last qualify escape create table view replace insert into values update set delete describe show').split(' '));

const TOKEN = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\s])/gi;

export function tokenize(sql) {
  const out = [];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(sql))) {
    if (m[1] !== undefined) out.push({ type: 'com', text: m[1] });
    else if (m[2] !== undefined) out.push({ type: 'str', text: m[2] });
    else if (m[3] !== undefined) out.push({ type: 'ident', text: m[3] });
    else if (m[4] !== undefined) out.push({ type: 'num', text: m[4] });
    else if (m[5] !== undefined) {
      const lower = m[5].toLowerCase();
      const rest = sql.slice(TOKEN.lastIndex);
      out.push({ type: KEYWORDS.has(lower) ? 'kw' : /^\s*\(/.test(rest) ? 'fn' : 'ident', text: m[5] });
    } else out.push({ type: m[6] !== undefined ? 'ws' : 'punct', text: m[0] });
  }
  return out;
}

// Names of tables mentioned after FROM or JOIN.
export function tablesIn(sql) {
  const tokens = tokenize(sql).filter((t) => t.type !== 'ws' && t.type !== 'com');
  const names = [];
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    if (t.type === 'ident' && prev?.type === 'kw' && /^(from|join)$/i.test(prev.text)) {
      names.push(t.text.startsWith('"') ? t.text.slice(1, -1).replaceAll('""', '"') : t.text);
    }
  });
  return [...new Set(names)];
}
