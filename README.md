# Query

Drop in a spreadsheet and get answers from it, with or without SQL.

Try it here: https://westons-hub.github.io/query/

## What it does

- Open a CSV or Excel file and see a quick summary of what's in it.
- It points out problems like duplicate rows, blank rows and names spelled different ways, and lets you fix them. Your original file is never changed.
- Ask a question by picking options from menus. It shows the SQL it wrote so you can learn from it, or you can write your own.
- See the answer in a table you can sort.

Everything runs in your browser. Your files are never uploaded anywhere.

## Run it on your computer

```bash
git clone https://github.com/westons-hub/query.git
cd query
npm start
```

Then open http://localhost:8321.

To run the tests: `npm test`

## Built with

Plain JavaScript, DuckDB and SheetJS. The sample data is made up.
