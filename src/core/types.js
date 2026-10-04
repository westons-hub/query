// Guesses what kind of data a column holds and converts raw text into values.
// Types: 'number', 'date', 'bool' (yes/no) and 'text'.

const BLANK_TOKENS = new Set(['', 'na', 'n/a', 'null', '#n/a', 'nan', '-', '--']);

export function isBlank(v) {
  return v == null || BLANK_TOKENS.has(String(v).trim().toLowerCase());
}

// ---------- numbers ----------

const CURRENCY = /^(?:[$€£¥]|USD|EUR|GBP)\s*|\s*(?:[$€£¥]|USD|EUR|GBP)$/gi;
const NUM_DOT = /^(?:\d{1,3}(?:[,  ']\d{3})+|\d+)?(?:\.\d*)?(?:e[+-]?\d+)?$/i;
const NUM_COMMA = /^(?:\d{1,3}(?:[.  ']\d{3})+|\d+)?(?:,\d*)?$/;

// decimal is '.' (1,200.50) or ',' (1.200,50).
export function parseNumber(raw, decimal = '.') {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1).trim(); }
  if (s.endsWith('%')) s = s.slice(0, -1).trim();
  const sign = () => {
    if (s.startsWith('-') || s.startsWith('−')) { negative = !negative; s = s.slice(1).trim(); }
    else if (s.startsWith('+')) s = s.slice(1).trim();
  };
  sign();
  s = s.replace(CURRENCY, '').trim();
  sign();
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1).trim(); }
  if (!/\d/.test(s)) return null;

  let plain;
  if (decimal === ',') {
    if (!NUM_COMMA.test(s)) return null;
    plain = s.replace(/[.  ']/g, '').replace(',', '.');
  } else {
    if (!NUM_DOT.test(s)) return null;
    plain = s.replace(/[,  ']/g, '');
  }
  const n = Number(plain);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// Decides whether a column writes decimals with a dot or a comma.
export function detectDecimal(values) {
  let dot = 0;
  let comma = 0;
  for (const v of values) {
    const s = String(v);
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot === -1 && lastComma === -1) continue;
    if (lastDot !== -1 && lastComma !== -1) {
      if (lastDot > lastComma) dot++; else comma++;
      continue;
    }
    const ch = lastDot !== -1 ? '.' : ',';
    const last = Math.max(lastDot, lastComma);
    const digitsAfter = s.slice(last + 1).replace(/\D+$/, '').length;
    if (s.indexOf(ch) !== last) {
      // Used more than once, so it groups thousands.
      if (ch === '.') comma++; else dot++;
    } else if (digitsAfter !== 3) {
      if (ch === '.') dot++; else comma++;
    }
  }
  return comma > dot ? ',' : '.';
}

function detectUnit(values) {
  let pct = 0;
  const symbols = new Map();
  for (const v of values) {
    const s = String(v);
    if (s.includes('%')) pct++;
    const m = s.match(/[$€£¥]/);
    if (m) symbols.set(m[0], (symbols.get(m[0]) || 0) + 1);
  }
  if (pct >= values.length * 0.8) return '%';
  for (const [sym, n] of symbols) if (n >= values.length * 0.8) return sym;
  return '';
}

// ---------- dates ----------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ISO_DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i;
const MONTH_FIRST_NAME = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/;
const DAY_FIRST_NAME = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]([A-Za-z]{3,9})\.?,?[\s-](\d{4}|\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');
const fullYear = (y) => (y.length === 2 ? (Number(y) < 50 ? 2000 : 1900) + Number(y) : Number(y));
const monthNumber = (name) => {
  const m = MONTHS[name.slice(0, 3).toLowerCase()];
  if (!m) return 0;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][m - 1];
  const lower = name.toLowerCase();
  return lower.length === 3 || lower === full || (lower === 'sept' && m === 9) ? m : 0;
};

function iso(y, m, d, hh, mm, ss, ampm) {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 9999) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  let out = `${y}-${pad(m)}-${pad(d)}`;
  if (hh !== undefined) {
    let h = Number(hh);
    if (ampm) {
      const p = ampm.toLowerCase();
      if (h < 1 || h > 12) return null;
      if (p === 'pm' && h < 12) h += 12;
      if (p === 'am' && h === 12) h = 0;
    }
    if (h > 23 || Number(mm) > 59 || Number(ss || 0) > 59) return null;
    out += ` ${pad(h)}:${mm}:${pad(Number(ss || 0))}`;
  }
  return out;
}

// order is 'MDY' (3/4/2024 = March 4) or 'DMY' (3/4/2024 = 3 April).
// Returns 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS', or null if it is not a date.
export function parseDate(raw, order = 'MDY') {
  const s = String(raw ?? '').trim();
  if (s.length < 6) return null;
  let m = ISO_DATE.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
  m = NUMERIC_DATE.exec(s);
  if (m) {
    const [month, day] = order === 'DMY' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return iso(fullYear(m[3]), month, day, m[4], m[5], m[6], m[7]);
  }
  m = MONTH_FIRST_NAME.exec(s);
  if (m) return iso(+m[3], monthNumber(m[1]), +m[2]);
  m = DAY_FIRST_NAME.exec(s);
  if (m) return iso(fullYear(m[3]), monthNumber(m[2]), +m[1]);
  return null;
}

// Looks at dates like 13/02/2024 (must be day-first) and 02/13/2024 (must be
// month-first) to decide the order for the whole column.
export function detectDateOrder(values) {
  let dayFirst = 0;
  let monthFirst = 0;
  let numeric = 0;
  for (const v of values) {
    const m = NUMERIC_DATE.exec(String(v).trim());
    if (!m) continue;
    numeric++;
    if (+m[1] > 12 && +m[2] <= 12) dayFirst++;
    else if (+m[2] > 12 && +m[1] <= 12) monthFirst++;
  }
  return {
    order: dayFirst > monthFirst ? 'DMY' : 'MDY',
    ambiguous: numeric > 0 && dayFirst === 0 && monthFirst === 0,
  };
}

// ---------- yes/no ----------

const TRUE_WORDS = new Set(['yes', 'y', 'true', 't']);
const FALSE_WORDS = new Set(['no', 'n', 'false', 'f']);

export function parseBool(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

// ---------- column guess ----------

const ENOUGH = 0.85; // share of values that must fit a type for the column to get it

export function guessType(values) {
  const filled = values.filter((v) => !isBlank(v));
  const n = filled.length;
  if (n === 0) return { type: 'text' };
  const share = (fn) => filled.reduce((k, v) => k + (fn(v) !== null ? 1 : 0), 0) / n;

  if (share(parseBool) >= ENOUGH) return { type: 'bool' };

  const decimal = detectDecimal(filled);
  if (share((v) => parseNumber(v, decimal)) >= ENOUGH) {
    // Codes such as 00123 or 07 are labels, not quantities.
    const codes = filled.filter((v) => /^0\d+$/.test(String(v).trim())).length;
    if (codes < n * 0.2) return { type: 'number', decimal, unit: detectUnit(filled) };
  }

  const { order, ambiguous } = detectDateOrder(filled);
  if (share((v) => parseDate(v, order)) >= ENOUGH) {
    const hasTime = filled.some((v) => (parseDate(v, order) || '').length > 10);
    return { type: 'date', order, ambiguous, hasTime };
  }
  return { type: 'text' };
}

// Fills in the details needed to treat a column as a type the user picked.
export function typeFor(values, type, order) {
  const filled = values.filter((v) => !isBlank(v));
  if (type === 'number') return { type, decimal: detectDecimal(filled), unit: detectUnit(filled), chosen: true };
  if (type === 'date') {
    const guess = detectDateOrder(filled);
    const o = order || guess.order;
    return { type, order: o, ambiguous: false, hasTime: filled.some((v) => (parseDate(v, o) || '').length > 10), chosen: true };
  }
  return { type, chosen: true };
}

// Converts one raw cell. Blank cells and cells that do not fit come back as null.
export function convert(raw, info) {
  if (isBlank(raw)) return null;
  switch (info.type) {
    case 'number': return parseNumber(raw, info.decimal);
    case 'date': return parseDate(raw, info.order);
    case 'bool': return parseBool(raw);
    default: return String(raw).trim();
  }
}

export const TYPE_LABELS = { number: 'Number', date: 'Date', text: 'Text', bool: 'Yes / No' };
