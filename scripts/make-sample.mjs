// Generates the fictional example data in examples/. Everything here is made
// up; the random generator is seeded so the files come out identical each run.
//   node scripts/make-sample.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { toDelimited } from '../src/core/csv.js';

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261003);
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [value, w] of pairs) { r -= w; if (r <= 0) return value; }
  return pairs[0][0];
};
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pad = (n, w = 2) => String(n).padStart(w, '0');
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// ---------- customers ----------
const FIRST = ['Amber', 'Birch', 'Cobalt', 'Driftwood', 'Ember', 'Fernhill', 'Granite', 'Harbor', 'Indigo', 'Juniper', 'Kestrel', 'Lantern', 'Meadow', 'Nimbus', 'Oakline', 'Pebble', 'Quill', 'Russet', 'Saffron', 'Tidewater'];
const SECOND = ['Supply', 'Outfitters', 'Goods', 'Trading', 'Market', 'Works', 'Provisions', 'Collective'];
const REGIONS = [['North', 3], ['South', 2], ['East', 2.5], ['West', 4]];
const SEGMENTS = [['Retail', 5], ['Wholesale', 2], ['Online', 3]];

const customers = [];
const usedNames = new Set();
while (customers.length < 80) {
  const name = `${pick(FIRST)} ${pick(SECOND)}`;
  if (usedNames.has(name)) continue;
  usedNames.add(name);
  const signup = new Date(Date.UTC(2022, int(0, 23), int(1, 28)));
  customers.push({
    customer_id: `C${pad(customers.length + 1, 3)}`,
    customer: name,
    region: weighted(REGIONS),
    segment: weighted(SEGMENTS),
    signup_date: isoDate(signup),
    newsletter: rand() < 0.6 ? 'Yes' : 'No',
  });
}

// ---------- products ----------
const CATALOG = {
  Camping: ['Two-Person Tent', 'Sleeping Bag', 'Camp Stove', 'Folding Chair', 'Lantern', 'Cooler'],
  Hiking: ['Day Pack', 'Trekking Poles', 'Trail Boots', 'Water Filter', 'Headlamp', 'Rain Shell'],
  Cycling: ['Road Helmet', 'Bike Lock', 'Repair Kit', 'Saddle Bag', 'Floor Pump', 'Cycling Gloves'],
  Water: ['Dry Bag', 'Paddle', 'Life Vest', 'Kayak Cart', 'Deck Compass', 'Throw Rope'],
};
const products = [];
for (const [category, names] of Object.entries(CATALOG)) {
  for (const product of names) {
    products.push({
      product_id: `P${pad(products.length + 1, 3)}`,
      product,
      category,
      unit_price: (int(12, 240) + pick([0, 0.5, 0.95, 0.99])).toFixed(2),
    });
  }
}

// ---------- orders ----------
const orders = [];
const start = Date.UTC(2024, 0, 1);
const days = 547; // Jan 2024 through Jun 2025
for (let i = 0; i < 1500; i++) {
  // Sales grow over time and peak in early summer and December.
  let day;
  for (;;) {
    day = int(0, days - 1);
    const month = new Date(start + day * 86400000).getUTCMonth();
    const season = [0.7, 0.7, 0.85, 1, 1.25, 1.4, 1.3, 1.1, 0.9, 0.85, 1, 1.35][month];
    if (rand() < (0.45 + (0.55 * day) / days) * (season / 1.4)) break;
  }
  const product = products[Math.floor(rand() ** 1.6 * products.length)];
  // A few orders point at customers missing from the customer list, so there is
  // something for the join warning to find.
  const customerId = i % 300 === 299 ? `C${pad(900 + (i % 7), 3)}` : customers[Math.floor(rand() ** 1.3 * customers.length)].customer_id;
  const quantity = weighted([[1, 5], [2, 4], [3, 2], [4, 1], [6, 0.6], [10, 0.3]]);
  const discount = weighted([[0, 6], [0.05, 2], [0.1, 1.5], [0.2, 0.5]]);
  orders.push({
    order_id: 10001 + i,
    order_date: isoDate(new Date(start + day * 86400000)),
    customer_id: customerId,
    product_id: product.product_id,
    quantity,
    amount: (quantity * Number(product.unit_price) * (1 - discount)).toFixed(2),
    status: weighted([['Delivered', 78], ['Shipped', 10], ['Returned', 7], ['Cancelled', 5]]),
    channel: weighted([['Web', 5], ['Store', 3], ['Phone', 1]]),
  });
}
orders.sort((a, b) => (a.order_date < b.order_date ? -1 : a.order_date > b.order_date ? 1 : a.order_id - b.order_id));
orders.forEach((o, i) => { o.order_id = 10001 + i; });

// ---------- a deliberately messy export ----------
const euro = (n) => {
  const [whole, cents] = n.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents} €`;
};
const REPS = ['Avery Lindqvist', 'Moss Okafor', 'Rhea Castellan', 'Juno Whitlock', 'Teodor Vance'];
const messyRegion = (r, i) => {
  if (i % 11 === 3) return r.toUpperCase();
  if (i % 13 === 5) return r.toLowerCase();
  if (i % 17 === 8) return r + ' ';
  if (r === 'South' && i % 9 === 4) return 'Soutth';
  return r;
};
const messyRows = [];
let totalUnits = 0;
let totalRevenue = 0;
for (let i = 0; i < 90; i++) {
  const d = new Date(Date.UTC(2025, int(0, 5), int(1, 28)));
  const region = pick(['North', 'South', 'East', 'West']);
  const category = pick(Object.keys(CATALOG));
  const units = int(1, 40);
  const revenue = units * (int(15, 180) + 0.5);
  totalUnits += units;
  totalRevenue += revenue;
  messyRows.push([
    `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`,
    messyRegion(region, i),
    pick(REPS),
    i % 19 === 7 ? category.toLowerCase() : category,
    i === 23 ? 'twelve' : i === 61 ? 'n/a' : String(units),
    i === 40 ? 'TBD' : euro(revenue),
    pick(['0%', '5%', '10%', '15%']),
    rand() < 0.8 ? 'Yes' : 'No',
  ]);
}
messyRows.sort((a, b) => a[0].split('.').reverse().join('').localeCompare(b[0].split('.').reverse().join('')));
// Duplicates and blank lines, as left behind by copy-and-paste.
messyRows.splice(30, 0, [...messyRows[29]]);
messyRows.splice(58, 0, [...messyRows[57]], [...messyRows[57]]);
messyRows.splice(45, 0, ['', '', '', '', '', '', '', '']);
messyRows.splice(77, 0, ['', '', '', '', '', '', '', '']);
messyRows.push(['Total', '', '', '', String(totalUnits), euro(totalRevenue), '', '']);

const messyHeader = ['Date', 'Region', 'Sales Rep', 'Category', 'Units', 'Revenue', 'Discount', 'Paid'];
const messy =
  'Larkspur Trading – regional sales export\n' +
  'Generated 03.07.2025 from the finance system. Figures are provisional.\n' +
  '\n' +
  toDelimited(messyHeader, messyRows, ';');

// ---------- write ----------
const table = (list) => [Object.keys(list[0]), list.map((o) => Object.values(o))];
mkdirSync(new URL('../examples/', import.meta.url), { recursive: true });
const out = (name, text) => writeFileSync(new URL(`../examples/${name}`, import.meta.url), text);
out('customers.csv', toDelimited(...table(customers)));
out('products.csv', toDelimited(...table(products)));
out('orders.csv', toDelimited(...table(orders)));
out('messy-sales.csv', messy);
console.log(`customers ${customers.length}, products ${products.length}, orders ${orders.length}, messy ${messyRows.length}`);
