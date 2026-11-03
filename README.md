# Select & Return

SQL + TypeScript capture-the-flag quiz that runs in the browser.

Only the first question is open. Solving a question shows a **keyword**; typing it into the next question unlocks it. The last question hands out the final flag.

🌐 **Live:** https://aroy-art.github.io/studious-giggle/

## ▶ Run

```sh
live-server --port=:5500 --browser=false
```

Open **http://localhost:5500**

> ⚠ Opening the file directly from disk won't work. You need a web server (`https://` or `localhost`, since unlocking uses WebCrypto).

## 🔐 How the questions are stored

| File | What it is | Published? |
| --- | --- | --- |
| `questions.src.json` | The questions in plain text, with answers and keywords | ❌ No, it's in `.gitignore`. Share it privately |
| `questions.json` | The same questions, encrypted. The page loads this | ✅ Yes |

Each question is encrypted (AES-GCM, key from PBKDF2) with the **previous question's keyword**, so nobody can read a question, its tests or its solution before unlocking it. The first question needs no keyword.

After every change to `questions.src.json`, rebuild:

```sh
node build.js
```

It checks the questions, writes `questions.json` and prints the chain of keywords. Commit `questions.json`.

> ⚠ Rebuilding with a changed keyword or a new question order means players' saved keywords stop working for the questions after the change.

## ✏️ Question editor

```sh
node editor.js
```

Open **http://localhost:5600** to edit `questions.src.json` in a form: add, reorder and delete questions, edit tests and keywords. **Save & build** (or <kbd>Ctrl</kbd>+<kbd>S</kbd>) writes the file, keeps the previous version as `questions.src.json.bak`, and runs `node build.js`. It only runs on your machine. Set `PORT` to use another port.

## ➕ Add a question

1. Open `questions.src.json`
2. Copy a question of the same type
3. Paste it at the end and put a comma between the two
4. Edit it, give it a new `keyword`, and save
5. Run `node build.js`

Questions are chained in sidebar order: all SQL questions first, then all TypeScript ones, each in file order.

Something wrong? A **red banner** on the page tells you what.

### SQL

```json
{
  "type": "sql",
  "title": "Pricey books",
  "keyword": "night ferry",
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
  "keyword": "twice as nice",
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
- Code is **type-checked in strict mode**. The learner's function must match the signature in `solution`, so write that one with proper types
- `expected` is JS code **in a string**: `"4"`, `"[]"`, `"true"`
- The question page shows an **example call**. Set `examples` to choose it yourself, so no test is revealed:
  ```json
  "examples": [{ "call": "double(5)", "returns": "10" }]
  ```
  Without `examples`, tests that don't have `hidden` are shown instead. Use `"examples": []` to show none.

- `keyword` is what a player gets for solving this question, and what unlocks the next one. Case and extra spaces don't matter. The last question's keyword is the final flag, e.g. `"flag{select-and-return}"`
- `viewedFlag` (last question only, optional) is the final flag for players who opened **any** solution along the way, e.g. `"flag{peeked}"`. Leave it out and `build.js` makes one from a hash, so neither flag can be guessed from the other

## 🧩 Optional fields

| Field | What it does |
| --- | --- |
| `level` | Label, e.g. `"Hard"`. Default `"Easy"`. |
| `hint` | Text shown by the Hint button |
| `id` | Keeps saved progress if you rename the question |
| `ordered` | SQL only. Set `false` if row order doesn't matter |
| `label` | Test name. Defaults to the `call` |
| `examples` | TS only. Example calls shown on the question page |

## 💡 Tips

- Use an **array of lines** for long text
- Use `'single quotes'` inside JSON strings
- Test it: run `node build.js`, unlock the question with the previous keyword, then **Solution → Load into editor → Run**

## 🗃 SQL tables

They're in `schema.json`. Each table has `columns` (with a `name` and a `type` of `INT` / `NUMBER` / `STRING`) and `rows` (one array per row).

> ⚠ Changing the data changes every SQL answer.
