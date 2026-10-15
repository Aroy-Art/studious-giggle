# Select & Return

SQL + TypeScript quiz that runs in the browser.

## ▶ Run

```sh
live-server --port=:5500 --browser=false
```

Open **http://localhost:5500/Select%20%26%20Return.html**

> ⚠ Opening the file directly from disk won't work. You need a web server.

## ➕ Add a question

1. Open `questions.json`
2. Copy a question of the same type
3. Paste it at the end and put a comma between the two
4. Edit it and save

Something wrong? A **red banner** on the page tells you what.

### SQL

```json
{
  "type": "sql",
  "title": "Pricey books",
  "prompt": ["Books over 15.00.", "Most expensive first."],
  "solution": ["SELECT title, price FROM books", "WHERE price > 15 ORDER BY price DESC"]
}
```

✅ The expected answer is computed from `solution`, so make sure the solution is right.

### TypeScript

```json
{
  "type": "ts",
  "title": "Double it",
  "prompt": "Return <code>n</code> times 2.",
  "starter": ["function double(n: number): number {", "  return 0;", "}"],
  "solution": ["function double(n: number): number {", "  return n * 2;", "}"],
  "tests": [
    { "call": "fn(2)", "expected": "4" },
    { "call": "fn(-3)", "expected": "-6", "hidden": true }
  ]
}
```

- `fn` is the learner's function
- `expected` is JS code **in a string**: `"4"`, `"[]"`, `"true"`

## 🧩 Optional fields

| Field | What it does |
| --- | --- |
| `level` | Label, e.g. `"Hard"`. Default `"Easy"`. |
| `hint` | Text shown by the Hint button |
| `id` | Keeps saved progress if you rename the question |
| `ordered` | SQL only. Set `false` if row order doesn't matter |
| `label` | Test name. Defaults to the `call` |

## 💡 Tips

- Use an **array of lines** for long text
- Use `'single quotes'` inside JSON strings
- Test it: **Show solution → Load into editor → Run**

## 🗃 SQL tables

They're in `schema.json`. Each table has `columns` (with a `name` and a `type` of `INT` / `NUMBER` / `STRING`) and `rows` (one array per row).

> ⚠ Changing the data changes every SQL answer.
