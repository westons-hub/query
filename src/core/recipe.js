// A recipe is the list of cleanup steps the user has accepted for a table.
// Steps are applied to a copy; the rows read from the file are never modified,
// so undoing a fix is simply dropping the last step.

import { isBlank } from './types.js';

const rowKey = (row) => row.map((c) => String(c).trim()).join('\u0001');

export function applyStep(headers, rows, step) {
  switch (step.op) {
    case 'remove_blank_rows':
      return rows.filter((row) => !row.every(isBlank));
    case 'remove_duplicates': {
      const seen = new Set();
      return rows.filter((row) => {
        if (row.every(isBlank)) return true;
        const key = rowKey(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    case 'remove_rows': {
      const drop = new Set(step.rows);
      return rows.filter((_, i) => !drop.has(i));
    }
    case 'blank_values': {
      const c = headers.indexOf(step.column);
      if (c === -1) return rows;
      const bad = new Set(step.values);
      return rows.map((row) => (bad.has(row[c]) ? row.with(c, '') : row));
    }
    case 'replace_values': {
      const c = headers.indexOf(step.column);
      if (c === -1) return rows;
      return rows.map((row) => (Object.hasOwn(step.map, row[c]) ? row.with(c, step.map[row[c]]) : row));
    }
    default:
      throw new Error(`Unknown cleanup step: ${step.op}`);
  }
}

export function applyRecipe(headers, rows, recipe = []) {
  return recipe.reduce((current, step) => applyStep(headers, current, step), rows);
}
