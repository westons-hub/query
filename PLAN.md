# Query — plan

## Context

Query is a portfolio project: a browser-only tool where anyone drops in CSV/Excel files and gets answers, with or without SQL. A recruiter opens one link and must see a result within 5 seconds. What sets it apart from other "SQL on CSV" tools: a no-SQL question builder that shows its SQL, messy-file cleanup as a first-class step, and an instant summary of every file.

Decisions already made with you:
- Project lives at `~/Documents/query` (new git repo, `main` branch).
- The home page `westons-hub.github.io` already exists (`~/Documents/portfolio`). Keep its design and **add Query as project 2**; no new repo, no card-page rewrite.
- Libraries are downloaded once and committed under `vendor/`.

## Key design choices

1. **Two layers, so the 5-second promise holds.**
   - *Pure JS core* (parsing, type guessing, summary, problem detection, SQL generation). Runs instantly, no engine needed, fully testable with `node --test`.
   - *DuckDB-WASM* (~35 MB) loads in the background in a worker. The sample data's summary cards and a pre-computed starter result with chart render immediately from the JS core; the "Run" buttons show "Engine loading…" until DuckDB is ready.
2. **Original files are never changed.** Each table keeps its raw rows plus a list of cleanup steps (a small "recipe"). The cleaned view = raw rows + recipe. Undo = remove the last step. The cleaned view is what gets loaded into DuckDB (as typed columns).
3. **One question model.** The builder edits a plain object (`{table, columns, filters, groupBy, calc, sort, limit, join}`); `sqlgen.js` turns it into SQL and `sentence.js` into English. Saved questions store this object (or raw SQL), so they can be re-run on any new file with the same column names.
4. **No framework.** Plain ES modules, small render functions, one CSS file with custom properties for light/dark (follows system, with a toggle).

## Libraries (vendored, pinned, with licenses)

| Library | Source | Notes |
|---|---|---|
| DuckDB-WASM | npm `@duckdb/duckdb-wasm` | `eh` + `mvp` builds and workers. If its ESM bundle needs `apache-arrow` as a separate import, vendor that too and wire it with an import map. |
| SheetJS | **cdn.sheetjs.com** (official), not npm | Change from what I asked earlier: the npm copy is frozen at an old version with known security bugs in file parsing. The official current build is only on SheetJS's own site. Download once, commit, no runtime CDN. |
| Chart.js | npm `chart.js` | Bar, line, pie, and built-in PNG export. |

`vendor/README.md` records version, source URL and checksum for each.

## Layout

```
~/Documents/query/
  index.html  styles.css  PLAN.md  README.md  .gitignore  package.json (scripts only, no deps)
  src/
    core/   csv.js  detect.js  types.js  profile.js  problems.js  recipe.js
            question.js  sqlgen.js  sentence.js  join.js  chartpick.js  export.js  saved.js
    ui/     app.js  dropzone.js  summary.js  problems-panel.js  builder.js  editor.js
            results.js (virtualized)  chart.js  saved-panel.js  history.js  theme.js
    engine/ duckdb.js (worker setup, load table, run query, error mapping)
  vendor/   duckdb/  sheetjs/  chartjs/
  examples/ orders.csv  customers.csv  products.csv  messy-sales.csv  (all fictional, generated)
  tests/    *.test.js + fixtures/
  .github/workflows/deploy.yml
```

## Phases (tests + local commit after each; nothing pushed)

**Setup** — create repo, set `user.email` to `282437423+westons-hub@users.noreply.github.com`, `.gitignore` (`*.csv`, `*.xlsx`, `*.xls`, `*.tsv` except `examples/` and `tests/fixtures/`), copy this plan to `PLAN.md`, vendor the libraries, generate fictional sample data with a seeded script.

**Phase 1 — Load and understand**
- `csv.js`: RFC-style parser (quotes, embedded commas/newlines). `detect.js`: encoding (BOM, UTF-8 check, Windows-1252 fallback), separator, real header row (skips notes/junk lines above it).
- `types.js`: number / date / text / yes-no guessing, including `$1,200`, `45%`, `(300)`, `1.000,50`, and day-first vs month-first dates (decided per column from values that are unambiguous; shown as a guess when it can't tell). One-click override per column.
- `profile.js`: rows, columns, blanks, distinct, min/max/average, date range, top values with %.
- `problems.js` + `recipe.js`: duplicate rows, blank rows, type mismatches, totals row at the bottom, inconsistent spellings (case/whitespace/punctuation and near-match grouping). Each fix has a before/after preview and undo.
- UI: drop zone (multiple files; each Excel sheet = a table), sample data loaded by default, "Use my own files" button, privacy note ("Your files never leave this browser").

**Phase 2 — Ask questions**
- Builder → live SQL + plain-English sentence. Join picker with unmatched-row warning (counts from both sides).
- SQL editor: highlighted overlay on a textarea (small own tokenizer, no extra library), clickable table/column names, Cmd/Ctrl+Enter, DuckDB errors mapped to line/column with a caret and a plain-language hint.
- Starter questions: specific ones for the sample, generic ones generated from each table's column types (duplicates, count by category, top 10, totals by month, blanks).
- Results table: virtualized rows, click-to-sort, row count and query time.

**Phase 3 — Use the answer**
- `chartpick.js` chooses bar / line / pie from the result shape and writes a title; chart type switcher; PNG download.
- Download CSV / Excel, copy as table (HTML + tab-separated, pastes cleanly into slides and email).
- Saved questions: localStorage in try/catch, export/import `.json`, re-run on a new file with matching columns (clear message listing any missing columns). Session history.

**Phase 4 — Polish and deploy**
- Phone layout, keyboard and screen-reader pass, contrast check for both themes (automated test over the colour tokens).
- README: live link and GIF first, then why, features, privacy, how it works. I'll capture the GIF frames from the running app; if the result isn't good enough I'll tell you and leave a clearly marked slot.
- `deploy.yml`: `node --test` → upload site → deploy to Pages on push to `main`.
- Final audit: scan working tree and full git history for any non-example data files.
- Footer: "← All projects" → `https://westons-hub.github.io/`.

**Home page (after Query is live)** — in `~/Documents/portfolio`, add Query as project 2 in the existing pinned projects section, matching the Orbit pattern (I'll read `index.html`/`style.css` first and show you the change before committing). Commit locally; push only when you say.

**Publishing (when you say "push")** — step-by-step clicks: create public repo `westons-hub/query`, add remote, push, Settings → Pages → Source = GitHub Actions, confirm `https://westons-hub.github.io/query/`.

## Verification

- `node --test` after every phase: parser edge cases, separator/header/encoding detection, each number and date format, summary figures, every problem detector and its fix + undo, SQL generation for each builder option, sentences, join warnings, chart choice, export round-trips, saved-question import/export, contrast ratios.
- Browser check after every phase with a local static server in the built-in browser: sample loads with a visible result straight away, drop the messy example and apply/undo each fix, run builder and editor queries against real DuckDB, 100k-row generated table scrolls smoothly, chart + downloads work, light/dark, phone width, no console errors, and the network log shows no requests outside the site.
- The generated SQL is tested as text in Node and executed for real in the browser check (DuckDB-WASM isn't run inside the Node tests).

## Known limits to state up front

- First visit downloads the ~35 MB engine in the background (cached afterwards); summaries and the sample result don't wait for it.
- Repo will be roughly 75 MB because both engine builds are vendored.
