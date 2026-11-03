#!/usr/bin/env node
// Local editor for questions.src.json. Run: node editor.js, then open http://localhost:5600
// Saving writes questions.src.json (the previous version goes to questions.src.json.bak)
// and runs build.js, so questions.json is always up to date.
// It only listens on localhost: the source file holds every answer and keyword.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 5600;
const SRC = path.join(__dirname, 'questions.src.json');
const BAK = SRC + '.bak';

// Same layout as the hand-written file: one key per line, but small flat objects
// inside lists (tests, examples) stay on one line.
function format(v, depth) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '[\n' + v.map(x => pad + '  ' + format(x, depth + 1)).join(',\n') + '\n' + pad + ']';
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    const flat = keys.every(k => v[k] === null || typeof v[k] !== 'object');
    if (flat && depth >= 3) return '{ ' + keys.map(k => JSON.stringify(k) + ': ' + JSON.stringify(v[k])).join(', ') + ' }';
    return '{\n' + keys.map(k => pad + '  ' + JSON.stringify(k) + ': ' + format(v[k], depth + 1)).join(',\n') + '\n' + pad + '}';
  }
  return JSON.stringify(v);
}

function runBuild() {
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(__dirname, 'build.js')], { cwd: __dirname }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout + stderr).trim() });
    });
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, status, value) => send(res, status, 'application/json', JSON.stringify(value));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 5e6) { reject(new Error('Too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) return send(res, 200, 'text/html; charset=utf-8', PAGE);
    if (req.url === '/api/questions' && req.method === 'GET') {
      if (!fs.existsSync(SRC)) return json(res, 200, { questions: [], missing: true });
      try { return json(res, 200, { questions: JSON.parse(fs.readFileSync(SRC, 'utf8')) }); }
      catch (e) { return json(res, 500, { error: 'questions.src.json is not valid JSON: ' + e.message }); }
    }
    if (req.url === '/api/questions' && req.method === 'PUT') {
      // Only same-origin pages may write. Blocks other sites from posting to localhost.
      const origin = req.headers.origin;
      if (origin && origin !== 'http://localhost:' + PORT && origin !== 'http://127.0.0.1:' + PORT) return json(res, 403, { error: 'Wrong origin.' });
      let list;
      try { list = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'Bad JSON: ' + e.message }); }
      if (!Array.isArray(list)) return json(res, 400, { error: 'Expected an array of questions.' });
      if (fs.existsSync(SRC)) fs.copyFileSync(SRC, BAK);
      fs.writeFileSync(SRC, format(list, 0) + '\n');
      return json(res, 200, await runBuild());
    }
    send(res, 404, 'text/plain', 'Not found');
  } catch (e) {
    json(res, 500, { error: String((e && e.message) || e) });
  }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log('Question editor: http://localhost:' + PORT));
}
module.exports = { format };

// ---------------------------------------------------------------- page
const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Question Editor</title>
<link rel="icon" href="data:," />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root {
  --bg: #EFEDE8; --surface: #F6F5F1; --sunken: #E6E3DC; --fg: #1A1A1A; --muted: #4D4D4D; --faint: #8A8A8A;
  --line: #1A1A1A; --soft: #C9C5BC; --accent: #5B21D6; --accent-ink: #FFFFFF; --accent-tint: #DDD3F6;
  --ok: #15803D; --ok-bg: #E2F5E8; --bad: #C0262D; --bad-bg: #FCE6E7;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0B0B0C; --surface: #141416; --sunken: #0F0F11; --fg: #ECECEE; --muted: #A1A1AA; --faint: #71717A;
    --line: #3F3F46; --soft: #2A2A30; --accent: #B79CFF; --accent-ink: #0B0B0C; --accent-tint: #2E2647;
    --ok: #7CF29A; --ok-bg: #0F2416; --bad: #FF7A7A; --bad-bg: #2A1012;
  }
}
:root[data-theme="dark"] {
  --bg: #0B0B0C; --surface: #141416; --sunken: #0F0F11; --fg: #ECECEE; --muted: #A1A1AA; --faint: #71717A;
  --line: #3F3F46; --soft: #2A2A30; --accent: #B79CFF; --accent-ink: #0B0B0C; --accent-tint: #2E2647;
  --ok: #7CF29A; --ok-bg: #0F2416; --bad: #FF7A7A; --bad-bg: #2A1012;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 var(--mono); }
button, input, select, textarea { font: inherit; color: inherit; }
.app { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 100vh; }
aside { border-right: 1px solid var(--line); padding: 18px 16px; display: grid; gap: 14px; align-content: start; position: sticky; top: 0; height: 100vh; overflow: auto; }
h1 { font-size: 16px; margin: 0; letter-spacing: 0.02em; }
h1 small { display: block; font-size: 12px; font-weight: 400; color: var(--muted); }
.list { position: relative; display: grid; padding-left: 22px; }
.list::before { content: ''; position: absolute; left: 7px; top: 10px; bottom: 10px; width: 2px; background: var(--soft); }
.item { position: relative; display: grid; grid-template-columns: 26px 34px minmax(0, 1fr); gap: 6px; align-items: center; text-align: left; padding: 7px 8px; border: 1px solid var(--soft); background: var(--surface); cursor: pointer; border-radius: 4px; }
.item::before { content: ''; position: absolute; left: -20px; top: 50%; width: 10px; height: 10px; margin-top: -5px; border-radius: 50%; background: var(--bg); border: 2px solid var(--accent); }
.item:hover { background: var(--sunken); }
.item[aria-current="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.item[aria-current="true"]::before { background: var(--accent); }
.item .n { color: var(--faint); font-size: 12px; }
.item[aria-current="true"] .n { color: inherit; }
.item .ty { font-size: 11px; font-weight: 600; border: 1px solid currentColor; text-align: center; border-radius: 3px; }
.item .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* the links between questions: a keyword hands over to the next node */
.link, .cap, .sec { position: relative; font-size: 12px; color: var(--muted); white-space: nowrap; }
.link { display: flex; gap: 6px; min-width: 0; padding: 7px 8px 7px 10px; }
.link b { overflow: hidden; text-overflow: ellipsis; }
.link::before { content: '▼'; position: absolute; left: -21px; top: 50%; margin-top: -8px; font-size: 10px; line-height: 16px; width: 12px; text-align: center; background: var(--bg); color: var(--accent); }
.link b { color: var(--fg); font-weight: 600; }
.link.missing, .link.missing b { color: var(--bad); }
.link.missing::before { color: var(--bad); }
.cap { padding: 4px 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; }
.cap::before { content: ''; position: absolute; left: -19px; top: 50%; width: 8px; height: 8px; margin-top: -4px; background: var(--fg); }
.cap.end::before { background: var(--ok); }
.sec { padding: 12px 8px 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; color: var(--accent); }
.flags { display: grid; gap: 2px; padding: 6px 8px; }
.flags span { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flags b { color: var(--ok); }
.flags .alt b { color: var(--muted); }
/* in the form: where this question sits in the chain */
.chainbox { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr); gap: 10px; align-items: stretch; }
.cb { display: grid; gap: 4px; align-content: start; padding: 10px 12px; border: 1px solid var(--soft); border-radius: 6px; background: var(--surface); min-width: 0; }
.cb.me { border-color: var(--accent); background: var(--accent-tint); }
.cb .v { overflow-wrap: anywhere; }
.cb .v b { color: var(--accent); }
.cb .go { justify-self: start; border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; text-decoration: underline; text-align: left; }
.arrow { align-self: center; color: var(--accent); font-size: 18px; }
.warn { color: var(--bad); }
.soft { color: var(--muted); font-style: italic; }
.note { font-size: 12px; color: var(--muted); margin: 0; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.btn { border: 1px solid var(--line); background: var(--surface); padding: 6px 12px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.btn:hover { background: var(--sunken); }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
.btn.danger:hover { color: var(--bad); border-color: var(--bad); background: var(--bad-bg); }
.btn.small { padding: 2px 8px; font-size: 12px; }
.btn[disabled] { opacity: 0.45; cursor: not-allowed; }
main { padding: 22px 28px 80px; min-width: 0; }
.bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 0 14px; background: var(--bg); border-bottom: 1px dashed var(--soft); margin-bottom: 18px; }
.status { color: var(--muted); font-size: 12.5px; }
.status.dirty { color: var(--accent); }
.form { display: grid; gap: 18px; max-width: 980px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
label.f { display: grid; gap: 5px; }
.lbl { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.lbl em { font-style: normal; font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--faint); }
input[type=text], select, textarea { width: 100%; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 7px 9px; }
textarea { resize: vertical; min-height: 70px; line-height: 1.5; tab-size: 2; white-space: pre; overflow-wrap: normal; overflow-x: auto; }
textarea.prose { white-space: pre-wrap; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.check { display: flex; gap: 8px; align-items: center; }
fieldset { border: 1px solid var(--soft); border-radius: 6px; padding: 12px 14px 14px; margin: 0; display: grid; gap: 10px; min-width: 0; }
legend { padding: 0 6px; }
.trow { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 2fr) minmax(0, 1.1fr) auto auto; gap: 6px; align-items: center; }
.trow.ex { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto; }
.thead { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.06em; }
.out { white-space: pre-wrap; font-size: 12.5px; padding: 10px 12px; border-radius: 4px; border-left: 3px solid var(--line); background: var(--surface); margin: 0 0 18px; max-width: 980px; }
.out.ok { border-color: var(--ok); background: var(--ok-bg); }
.out.bad { border-color: var(--bad); background: var(--bad-bg); }
.empty { color: var(--muted); }
@media (max-width: 760px) {
  .app { grid-template-columns: 1fr; }
  aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  main { padding: 16px 16px 60px; }
  .trow, .trow.ex { grid-template-columns: 1fr; padding-bottom: 8px; border-bottom: 1px dashed var(--soft); }
  .chainbox { grid-template-columns: 1fr; }
  .arrow { transform: rotate(90deg); justify-self: center; }
  .thead { display: none; }
}
</style>
</head>
<body>
<div class="app">
  <aside>
    <h1>Question editor<small>questions.src.json</small></h1>
    <div class="row">
      <button class="btn" id="add-sql" type="button">+ SQL</button>
      <button class="btn" id="add-ts" type="button">+ TS</button>
    </div>
    <nav class="list" id="list" aria-label="Questions"></nav>
    <p class="note">Players go top to bottom: all SQL, then all TypeScript. Each keyword unlocks the next question. ↑/↓ reorder within a section.</p>
  </aside>
  <main>
    <div class="bar">
      <button class="btn primary" id="save" type="button">Save &amp; build</button>
      <span class="status" id="status">Loading…</span>
      <span style="flex:1"></span>
      <button class="btn small" id="up" type="button" title="Move up">↑</button>
      <button class="btn small" id="down" type="button" title="Move down">↓</button>
      <button class="btn small danger" id="del" type="button">Delete</button>
    </div>
    <pre class="out" id="out" hidden></pre>
    <div class="form" id="form"></div>
  </main>
</div>
<script>
'use strict';
const $ = s => document.querySelector(s);
let qs = [], sel = 0, dirty = false, saving = false, armedDelete = false;

// Keys are written in this order; anything else the file has is kept after them.
const ORDER = ['type', 'id', 'title', 'level', 'keyword', 'viewedFlag', 'prompt', 'hint', 'ordered', 'fnName', 'starter', 'solution', 'check', 'examples', 'tests'];
function tidy(q) {
  const out = {};
  for (const k of ORDER) if (q[k] !== undefined) out[k] = q[k];
  for (const k of Object.keys(q)) if (!(k in out) && q[k] !== undefined) out[k] = q[k];
  return out;
}

// Text areas hold lines; the file stores multi-line text as an array of lines.
const toText = v => (Array.isArray(v) ? v.join('\n') : v == null ? '' : String(v));
function fromText(text, alwaysArray) {
  const lines = text.replace(/\s+$/, '').split('\n');
  if (!text.trim()) return undefined;
  return lines.length > 1 || alwaysArray ? lines : lines[0];
}

function setDirty(d) {
  dirty = d;
  const s = $('#status');
  s.textContent = d ? 'Unsaved changes' : 'Saved';
  s.classList.toggle('dirty', d);
}

const TRACK_NAME = { sql: 'SQL', ts: 'TypeScript' };
const TRACKS = ['sql', 'ts'];
// build.js unlocks questions in this order, so the editor keeps the list in it too.
function chainSort() {
  const current = qs[sel];
  qs = qs.map((q, i) => [q, i]).sort((a, b) => TRACKS.indexOf(a[0].type) - TRACKS.indexOf(b[0].type) || a[1] - b[1]).map(x => x[0]);
  sel = Math.max(0, qs.indexOf(current));
}
const nameOf = i => String(i + 1).padStart(2, '0') + ' ' + (qs[i].title || '(untitled)');
const isLast = i => i === qs.length - 1;

function renderList() {
  const list = $('#list');
  list.innerHTML = '';
  if (!qs.length) { list.innerHTML = '<p class="note">No questions yet.</p>'; return; }
  list.append(el('div', { className: 'cap', textContent: 'Start · first question is open' }));
  qs.forEach((q, i) => {
    if (!i || qs[i - 1].type !== q.type) list.append(el('div', { className: 'sec', textContent: '## ' + TRACK_NAME[q.type] }));
    const b = el('button', { type: 'button', className: 'item', onclick: () => { sel = i; armedDelete = false; render(); } });
    b.setAttribute('aria-current', String(i === sel));
    b.append(
      el('span', { className: 'n', textContent: String(i + 1).padStart(2, '0') }),
      el('span', { className: 'ty', textContent: q.type === 'ts' ? 'TS' : 'SQL' }),
      el('span', { className: 't', textContent: q.title || '(untitled)' }));
    list.append(b);
    if (!q.keyword) {
      list.append(el('div', { className: 'link missing', title: 'Missing keyword' }, ['⚠', el('b', { textContent: 'no keyword' })]));
    } else if (!isLast(i)) {
      list.append(el('div', { className: 'link', title: 'Solving ' + nameOf(i) + ' gives this keyword. It unlocks ' + nameOf(i + 1) + '.' }, ['🔑', el('b', { textContent: q.keyword })]));
    }
  });
  const last = qs[qs.length - 1];
  list.append(el('div', { className: 'flags' }, [
    el('span', { title: 'Final flag' }, ['🏁 ', el('b', { textContent: last.keyword || '—' })]),
    el('span', { className: 'alt', title: 'Final flag when any solution was viewed' }, ['👁 ', el('b', { textContent: last.viewedFlag || 'auto' }), ' if a solution was viewed']),
  ]));
  list.append(el('div', { className: 'cap end', textContent: 'End' }));
}

// Where the selected question sits: what unlocks it, and what it unlocks.
function chainBox() {
  const i = sel, q = qs[i];
  const go = j => el('button', { type: 'button', className: 'go', textContent: nameOf(j), onclick: () => { sel = j; render(); } });
  const kw = (text, warnText, soft) => (text ? el('b', { textContent: '“' + text + '”' }) : el('span', { className: soft ? 'soft' : 'warn', textContent: warnText }));
  const before = i === 0
    ? el('div', { className: 'cb' }, [labelText('Unlocked by'), el('div', { className: 'v', textContent: 'Nothing. This is the first question, open from the start.' })])
    : el('div', { className: 'cb' }, [labelText('Unlocked by'), el('div', { className: 'v' }, ['the keyword ', kw(qs[i - 1].keyword, 'missing'), ' from']), go(i - 1)]);
  const me = el('div', { className: 'cb me' }, [labelText('This question'), el('div', { className: 'v', textContent: nameOf(i) })]);
  const after = isLast(i)
    ? el('div', { className: 'cb' }, [labelText('Hands out'), el('div', { className: 'v' }, ['the final flag ', kw(q.keyword, 'missing')]),
      el('div', { className: 'v' }, ['or ', kw(q.viewedFlag, 'an auto-made flag', true), ' if any solution was viewed'])])
    : el('div', { className: 'cb' }, [labelText('Hands out'), el('div', { className: 'v' }, ['the keyword ', kw(q.keyword, 'missing'), ' which unlocks']), go(i + 1)]);
  return el('div', { className: 'chainbox', id: 'chainbox' }, [before, el('span', { className: 'arrow', textContent: '→' }), me, el('span', { className: 'arrow', textContent: '→' }), after]);
}

// Small DOM builders.
function el(tag, props, kids) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  (kids || []).forEach(k => e.append(k));
  return e;
}
const labelText = (text, aside) => {
  const s = el('span', { className: 'lbl', textContent: text });
  if (aside) s.append(' ', el('em', { textContent: aside }));
  return s;
};
function field(text, aside, input) { return el('label', { className: 'f' }, [labelText(text, aside), input]); }

function textInput(q, key, placeholder) {
  return el('input', {
    type: 'text', value: q[key] == null ? '' : String(q[key]), placeholder: placeholder || '', spellcheck: false,
    oninput: e => { q[key] = e.target.value === '' ? undefined : e.target.value; changed(); },
  });
}
function area(q, key, opts) {
  const t = el('textarea', {
    value: toText(q[key]), rows: Math.max(opts.rows || 4, toText(q[key]).split('\n').length + 1), spellcheck: !!opts.prose, className: opts.prose ? 'prose' : '',
    oninput: e => { q[key] = fromText(e.target.value, opts.lines); changed(); },
  });
  if (!opts.prose) t.addEventListener('keydown', tabIndent);
  return t;
}
// Tab inserts two spaces in code areas; Esc then Tab moves focus as usual.
let escaped = false;
function tabIndent(e) {
  if (e.key === 'Escape') { escaped = true; return; }
  if (e.key === 'Tab' && !e.shiftKey && !escaped) {
    e.preventDefault();
    e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end');
    e.target.dispatchEvent(new Event('input'));
  }
  if (e.key !== 'Shift') escaped = false;
}

function changed() {
  setDirty(true);
  renderList();
  const box = $('#chainbox');
  if (box && qs.length) box.replaceWith(chainBox());
}

function render() {
  renderList();
  const form = $('#form');
  form.innerHTML = '';
  $('#del').disabled = !qs.length;
  $('#up').disabled = !qs[sel - 1] || qs[sel - 1].type !== qs[sel].type;
  $('#down').disabled = !qs[sel + 1] || qs[sel + 1].type !== qs[sel].type;
  $('#del').textContent = armedDelete ? 'Click again to delete' : 'Delete';
  if (!qs.length) { form.append(el('p', { className: 'empty', textContent: 'Add a question with + SQL or + TS.' })); return; }
  const q = qs[sel];
  const isTs = q.type === 'ts';

  // Changing the type moves the question into the other section of the chain.
  const type = el('select', {
    onchange: e => { q.type = e.target.value; chainSort(); changed(); render(); },
  }, [el('option', { value: 'sql', textContent: 'SQL' }), el('option', { value: 'ts', textContent: 'TypeScript' })]);
  type.value = q.type;

  form.append(chainBox());
  form.append(el('div', { className: 'grid' }, [
    field('Type', '', type),
    field('Title', '', textInput(q, 'title')),
    field('Level', 'default Easy', textInput(q, 'level', 'Easy')),
  ]));
  form.append(el('div', { className: 'grid' }, [
    field(isLast(sel) ? 'Final flag' : 'Keyword', isLast(sel) ? 'shown when solved' : 'shown when solved, unlocks the next question', textInput(q, 'keyword', isLast(sel) ? 'e.g. flag{...}' : 'e.g. night ferry')),
    field('Id', 'optional, keeps progress when renaming', textInput(q, 'id')),
  ]));
  if (isLast(sel)) {
    form.append(el('div', { className: 'grid' }, [
      field('Final flag if a solution was viewed', 'blank = made from a hash on build', textInput(q, 'viewedFlag', 'e.g. flag{peeked}')),
    ]));
  }
  form.append(field('Prompt', 'one paragraph per line, HTML allowed', area(q, 'prompt', { rows: 3, prose: true })));
  form.append(field('Hint', 'optional', area(q, 'hint', { rows: 2, prose: true })));

  if (isTs) {
    form.append(field('Starter', 'what the editor starts with', area(q, 'starter', { rows: 8, lines: true })));
    form.append(field('Solution', 'its function signature is enforced', area(q, 'solution', { rows: 10, lines: true })));
    form.append(testsBox(q));
    form.append(examplesBox(q));
  } else {
    form.append(field('Solution', 'the expected result is computed from this', area(q, 'solution', { rows: 6, lines: true })));
    form.append(field('Starter', 'optional', area(q, 'starter', { rows: 3, lines: true })));
    form.append(field('Check query', 'optional; set it for INSERT / UPDATE / DELETE questions, e.g. SELECT name, city FROM customers', area(q, 'check', { rows: 2 })));
    const ordered = el('input', { type: 'checkbox', checked: q.ordered !== false, onchange: e => { q.ordered = e.target.checked ? undefined : false; changed(); } });
    form.append(el('label', { className: 'check' }, [ordered, 'Row order matters (uncheck if any order is fine)']));
  }
}

function rowInput(obj, key, placeholder) {
  return el('input', {
    type: 'text', value: obj[key] == null ? '' : String(obj[key]), placeholder, spellcheck: false,
    oninput: e => { obj[key] = e.target.value === '' ? undefined : e.target.value; changed(); },
  });
}

function testsBox(q) {
  if (!Array.isArray(q.tests)) q.tests = [];
  const box = el('fieldset', {}, [el('legend', {}, [labelText('Tests', 'fn is the learner\'s function; expected is JS code')])]);
  box.append(el('div', { className: 'trow thead' }, ['Label', 'Call', 'Expected', 'Hidden', '']));
  q.tests.forEach((t, i) => {
    const hidden = el('input', { type: 'checkbox', checked: !!t.hidden, title: 'Hidden test', onchange: e => { t.hidden = e.target.checked || undefined; changed(); } });
    const del = el('button', { type: 'button', className: 'btn small danger', textContent: '✕', title: 'Remove test', onclick: () => { q.tests.splice(i, 1); changed(); render(); } });
    box.append(el('div', { className: 'trow' }, [rowInput(t, 'label', 'optional'), rowInput(t, 'call', 'fn(2)'), rowInput(t, 'expected', '4'), hidden, del]));
  });
  box.append(el('div', { className: 'row' }, [el('button', {
    type: 'button', className: 'btn small', textContent: '+ Test',
    onclick: () => { q.tests.push({ call: 'fn()', expected: '' }); changed(); render(); },
  })]));
  return box;
}

function examplesBox(q) {
  const mode = q.examples === undefined ? 'auto' : q.examples.length ? 'custom' : 'none';
  const pick = el('select', {
    onchange: e => {
      const v = e.target.value;
      q.examples = v === 'auto' ? undefined : v === 'none' ? [] : [{ call: '', returns: '' }];
      changed(); render();
    },
  }, [
    el('option', { value: 'auto', textContent: 'From the visible tests' }),
    el('option', { value: 'none', textContent: 'None' }),
    el('option', { value: 'custom', textContent: 'Custom' }),
  ]);
  pick.value = mode;
  const box = el('fieldset', {}, [el('legend', {}, [labelText('Examples', 'shown on the question page')]), pick]);
  if (mode === 'custom') {
    box.append(el('div', { className: 'trow ex thead' }, ['Call (use the real function name)', 'Returns', '']));
    q.examples.forEach((ex, i) => {
      const del = el('button', { type: 'button', className: 'btn small danger', textContent: '✕', onclick: () => { q.examples.splice(i, 1); if (!q.examples.length) q.examples = undefined; changed(); render(); } });
      box.append(el('div', { className: 'trow ex' }, [rowInput(ex, 'call', 'double(5)'), rowInput(ex, 'returns', '10'), del]));
    });
    box.append(el('div', { className: 'row' }, [el('button', {
      type: 'button', className: 'btn small', textContent: '+ Example',
      onclick: () => { q.examples.push({ call: '', returns: '' }); changed(); render(); },
    })]));
  }
  return box;
}

function showOut(kind, text) {
  const o = $('#out');
  o.hidden = !text;
  o.className = 'out ' + kind;
  o.textContent = text || '';
}

async function save() {
  if (saving) return;
  saving = true; $('#save').disabled = true;
  $('#status').textContent = 'Saving…';
  try {
    const body = JSON.stringify(qs.map(tidy));
    const r = await fetch('/api/questions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    const data = await r.json();
    if (!r.ok) { showOut('bad', data.error || 'Save failed.'); setDirty(true); return; }
    setDirty(false);
    showOut(data.ok ? 'ok' : 'bad', data.ok ? data.output : 'Saved questions.src.json, but the build failed. questions.json was not updated.\n\n' + data.output);
  } catch (e) {
    showOut('bad', 'Could not reach the editor server. Is node editor.js still running?');
    setDirty(true);
  } finally {
    saving = false; $('#save').disabled = false;
  }
}

function add(type) {
  const q = type === 'sql'
    ? { type: 'sql', title: 'New SQL question', keyword: '', prompt: '', solution: ['SELECT ', 'FROM '] }
    : { type: 'ts', title: 'New TS question', keyword: '', prompt: '', starter: ['function name(n: number): number {', '  return 0;', '}'], solution: ['function name(n: number): number {', '  return n;', '}'], tests: [{ call: 'fn(1)', expected: '1' }] };
  // New questions go after the last one of their track, where they will sit in the chain anyway.
  let at = qs.length;
  for (let i = qs.length - 1; i >= 0; i--) { if (qs[i].type === type) { at = i + 1; break; } if (type === 'sql') at = i; }
  qs.splice(at, 0, q);
  sel = at; armedDelete = false;
  changed(); render();
}

function move(d) {
  const j = sel + d;
  if (j < 0 || j >= qs.length || qs[j].type !== qs[sel].type) return;
  [qs[sel], qs[j]] = [qs[j], qs[sel]];
  sel = j;
  changed(); render();
}

$('#add-sql').addEventListener('click', () => add('sql'));
$('#add-ts').addEventListener('click', () => add('ts'));
$('#save').addEventListener('click', save);
$('#up').addEventListener('click', () => move(-1));
$('#down').addEventListener('click', () => move(1));
$('#del').addEventListener('click', () => {
  if (!armedDelete) { armedDelete = true; render(); return; }
  armedDelete = false;
  qs.splice(sel, 1);
  sel = Math.max(0, Math.min(sel, qs.length - 1));
  changed(); render();
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

fetch('/api/questions').then(r => r.json()).then(data => {
  if (data.error) { showOut('bad', data.error); $('#status').textContent = 'Not loaded'; $('#save').disabled = true; return; }
  qs = data.questions;
  chainSort();
  if (data.missing) showOut('', 'questions.src.json does not exist yet. Saving will create it.');
  setDirty(false);
  render();
}).catch(() => showOut('bad', 'Could not load the questions.'));
</script>
</body>
</html>
`;
