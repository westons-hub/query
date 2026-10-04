// Turns values into text for people to read.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtCount(n) {
  return Number(n).toLocaleString('en-US');
}

export function fmtNumber(n, unit = '') {
  if (n == null || Number.isNaN(n)) return '';
  if (unit === 'id') return String(n);
  const abs = Math.abs(n);
  const digits = Number.isInteger(n) ? 0 : abs >= 100 ? 2 : abs >= 1 ? 2 : 4;
  const text = n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: Number.isInteger(n) ? 0 : Math.min(digits, 2) });
  if (unit === '%') return text + '%';
  if (unit) return n < 0 ? `-${unit}${text.slice(1)}` : unit + text;
  return text;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const day = `${MONTHS[m - 1]} ${d}, ${y}`;
  return iso.length > 10 ? `${day} ${iso.slice(11, 16)}` : day;
}

export function fmtValue(value, type, unit) {
  if (value == null) return '';
  if (type === 'number') return fmtNumber(value, unit);
  if (type === 'date') return fmtDate(value);
  if (type === 'bool') return value ? 'Yes' : 'No';
  return String(value);
}

export function fmtDuration(ms) {
  if (ms < 1) return 'under 1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

export const plural = (n, one, many = one + 's') => `${fmtCount(n)} ${n === 1 ? one : many}`;
