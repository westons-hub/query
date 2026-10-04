// Ready-made questions: a set written for the sample data, and generic ones
// worked out from any table's columns.

import { col, newQuestion, ident } from './sqlgen.js';

export function sampleStarters() {
  const amount = col('orders', 'amount');
  return [
    {
      label: 'Sales by month',
      question: { ...newQuestion('orders'), groupBy: [{ ref: col('orders', 'order_date'), bucket: 'month' }], calc: { fn: 'sum', ref: amount }, sort: { by: col('orders', 'order_date'), dir: 'asc' } },
    },
    {
      label: 'Top 10 products',
      question: { ...newQuestion('orders'), join: { table: 'products', left: 'product_id', right: 'product_id' }, groupBy: [{ ref: col('products', 'product') }], calc: { fn: 'sum', ref: amount }, sort: { by: 'calc', dir: 'desc' }, limit: 10 },
    },
    {
      label: 'Sales by region',
      question: { ...newQuestion('orders'), join: { table: 'customers', left: 'customer_id', right: 'customer_id' }, groupBy: [{ ref: col('customers', 'region') }], calc: { fn: 'sum', ref: amount }, sort: { by: 'calc', dir: 'desc' } },
    },
    {
      label: 'Returns by category',
      question: { ...newQuestion('orders'), join: { table: 'products', left: 'product_id', right: 'product_id' }, filters: [{ ref: col('orders', 'status'), op: 'eq', value: 'Returned' }], groupBy: [{ ref: col('products', 'category') }], calc: { fn: 'count' }, sort: { by: 'calc', dir: 'desc' } },
    },
    {
      label: 'Average order by channel',
      question: { ...newQuestion('orders'), groupBy: [{ ref: col('orders', 'channel') }], calc: { fn: 'avg', ref: amount }, sort: { by: 'calc', dir: 'desc' } },
    },
  ];
}

// profile is the summary from profileTable().
export function genericStarters(table, profile) {
  const cols = profile.columns;
  const out = [{ label: 'All rows', question: newQuestion(table) }];

  const category = cols
    .filter((c) => (c.type === 'text' || c.type === 'bool') && c.distinct >= 2 && c.distinct <= 50 && c.distinct < c.filled)
    .sort((a, b) => a.distinct - b.distinct)[0];
  const number = cols.find((c) => c.type === 'number' && c.unit !== 'id' && c.distinct > 1);
  const date = cols.find((c) => c.type === 'date');

  if (category) {
    out.push({
      label: `Count by ${category.name}`,
      question: { ...newQuestion(table), groupBy: [{ ref: col(table, category.name) }], calc: { fn: 'count' }, sort: { by: 'calc', dir: 'desc' } },
    });
  }
  if (number) {
    out.push({
      label: `Top 10 by ${number.name}`,
      question: { ...newQuestion(table), sort: { by: col(table, number.name), dir: 'desc' }, limit: 10 },
    });
  }
  if (date && number) {
    out.push({
      label: 'Totals by month',
      question: { ...newQuestion(table), groupBy: [{ ref: col(table, date.name), bucket: 'month' }], calc: { fn: 'sum', ref: col(table, number.name) }, sort: { by: col(table, date.name), dir: 'asc' } },
    });
  }
  out.push({
    label: 'Show duplicates',
    sql: `-- Rows that appear more than once, with how many copies\nSELECT *, COUNT(*) AS copies\nFROM ${ident(table)}\nGROUP BY ALL\nHAVING COUNT(*) > 1\nORDER BY copies DESC`,
  });
  const blanks = cols.filter((c) => c.blanks > 0);
  const check = (blanks.length ? blanks : cols).map((c) => `${ident(c.name)} IS NULL`);
  out.push({
    label: 'Find blanks',
    sql: `-- Rows with a blank in ${blanks.length ? 'any column that has blanks' : 'any column'}\nSELECT *\nFROM ${ident(table)}\nWHERE ${check.join('\n   OR ')}`,
  });
  return out;
}
