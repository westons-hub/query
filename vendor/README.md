# Vendored libraries

These files are committed so the site makes no third-party requests at runtime.

| Library | Version | Source | License |
|---|---|---|---|
| DuckDB-WASM | 1.33.1-dev57.0 | npm `@duckdb/duckdb-wasm` (`dist/`) | MIT |
| Apache Arrow JS | 17.0.0 | npm `apache-arrow` (bundled into `duckdb-browser.bundle.mjs`) | Apache-2.0 |
| SheetJS CE | 0.20.3 | https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs | Apache-2.0 |
| Chart.js | 4.5.1 | npm `chart.js` (`dist/chart.umd.min.js`) | MIT |

`duckdb/duckdb-browser.bundle.mjs` is DuckDB-WASM's `duckdb-browser.mjs` with its one
external import (`apache-arrow`) inlined, so it loads as a single ES module with no
import map. It was produced once with:

    npx esbuild node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser.mjs \
      --bundle --format=esm --minify --outfile=duckdb-browser.bundle.mjs

The `.wasm` and `.worker.js` files are unmodified copies.

## SHA-256

    fa889e6068c40426dea67c08cf16ce0cad7404eae94f6a2522adcabb5898eb93  duckdb/duckdb-browser-eh.worker.js
    964f678d3bfa5a23deb154e0a7950634a4d1415e571040ab2d47815dc3f13582  duckdb/duckdb-browser-mvp.worker.js
    1cbebabd31839c9660cd3c4dd2f773436ae0f06e147bc3720e4f4240c33207bf  duckdb/duckdb-browser.bundle.mjs
    3abdec74989dcc54d2f2ea5621f611f3c45db1e7dff2f408476014d82beb2029  duckdb/duckdb-eh.wasm
    ee5560145a3d3e0ffa6dce697be802c08842f139a594698eecc7c754f7ad5f05  duckdb/duckdb-mvp.wasm
    1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db  sheetjs/xlsx.mjs
    48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a  chartjs/chart.umd.min.js
