// Questions and SQL tables are loaded from these files. See README.md for the formats.
const QUESTIONS_URL = 'questions.json';
const SCHEMA_URL = 'schema.json';

// Question bank for "Select & Return". Pure data, no DOM, so it can be tested in Node.
function buildQuiz(QUESTION_LIST, schemaJson) {
  if (!Array.isArray(QUESTION_LIST)) QUESTION_LIST = [];
  const problems = [];

  // schema.json: { table: { columns: [{ name, type }], rows: [[...], ...] } }. Rows become objects keyed by column.
  const TYPE_ALIAS = { INT: 'INT', INTEGER: 'INT', NUMBER: 'NUMBER', DECIMAL: 'NUMBER', FLOAT: 'NUMBER', STRING: 'STRING', TEXT: 'STRING' };
  const SCHEMA = {};
  for (const [table, def] of Object.entries(schemaJson || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) { problems.push('Table "' + table + '": names may only use letters, digits and _.'); continue; }
    if (!def || !Array.isArray(def.columns) || !def.columns.length) { problems.push('Table "' + table + '": missing columns.'); continue; }
    const cols = def.columns.map(c => [c.name, TYPE_ALIAS[String(c.type || 'STRING').toUpperCase()] || 'STRING']);
    const data = Array.isArray(def.rows) ? def.rows : [];
    const bad = data.findIndex(r => !Array.isArray(r) || r.length !== cols.length);
    if (bad >= 0) { problems.push('Table "' + table + '": row ' + (bad + 1) + ' should have ' + cols.length + ' values, one per column.'); continue; }
    SCHEMA[table] = { cols, rows: data.map(r => Object.fromEntries(cols.map((c, i) => [c[0], r[i]]))) };
  }

  // Join an array of lines, then strip the leading/trailing blank line and the shared indentation.
  function dedent(s) {
    const text = Array.isArray(s) ? s.join('\n') : s;
    const lines = String(text == null ? '' : text).replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '').split('\n');
    const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length));
    return lines.map(l => l.slice(indent)).join('\n');
  }
  // Plain lines become paragraphs; a prompt that already has <p> tags is used as written.
  function promptHTML(s) {
    const text = dedent(s);
    if (/<p[\s>]/i.test(text)) return text;
    return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => '<p>' + l + '</p>').join('');
  }
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Turn the questions.json entries into the shape the app uses, collecting mistakes.
  const seen = new Set();
  const QUESTIONS = [];
  QUESTION_LIST.forEach((raw, i) => {
    const where = 'Question ' + (i + 1) + (raw && raw.title ? ' ("' + raw.title + '")' : '');
    const missing = f => { problems.push(where + ': missing ' + f + '.'); };
    if (!raw || (raw.type !== 'sql' && raw.type !== 'ts')) { problems.push(where + ": type must be 'sql' or 'ts'."); return; }
    if (!raw.title) return missing('title');
    if (!raw.prompt) return missing('prompt');
    if (!raw.solution) return missing('solution');

    let id = raw.id || raw.type + '-' + slug(raw.title);
    for (let n = 2; seen.has(id); n++) id = (raw.id || raw.type + '-' + slug(raw.title)) + '-' + n;
    seen.add(id);

    const q = {
      id, track: raw.type, title: raw.title, level: raw.level || 'Easy',
      prompt: promptHTML(raw.prompt), hint: raw.hint ? dedent(raw.hint) : '',
    };
    if (raw.type === 'sql') {
      q.solution = dedent(raw.solution);
      q.ordered = raw.ordered !== false;
      if (raw.starter != null) q.starter = dedent(raw.starter) + '\n';
    } else {
      if (!raw.starter) return missing('starter');
      if (!Array.isArray(raw.tests) || !raw.tests.length) return missing('tests');
      q.starter = dedent(raw.starter) + '\n';
      q.solution = dedent(raw.solution) + '\n';
      q.fnName = raw.fnName || (q.starter.match(/function\s+([A-Za-z_$][\w$]*)/) || [])[1];
      if (!q.fnName) return missing("fnName (no 'function name(' found in starter)");
      q.tests = raw.tests.map(t => ({
        label: t.label || t.call, visible: !t.hidden, call: String(t.call), expected: String(t.expected),
      }));
      // Optional example calls shown on the question page instead of the visible tests.
      // Each is a string ("fn(1)") or { call, returns }.
      if (raw.examples != null) {
        q.examples = [].concat(raw.examples).filter(Boolean).map(e => (typeof e === 'string'
          ? { call: e, returns: null }
          : { call: String(e.call || ''), returns: e.returns != null ? String(e.returns) : null }));
      }
    }
    QUESTIONS.push(q);
  });

  // Keep each track together so Previous/Next follows the sidebar order.
  const TRACKS = [['sql', 'SQL'], ['ts', 'TypeScript']];
  const ordered = TRACKS.flatMap(([t]) => QUESTIONS.filter(q => q.track === t));

  return { SCHEMA, QUESTIONS: ordered, TRACKS, problems };
}
if (typeof module !== 'undefined') module.exports = buildQuiz;

// Engine for "Select & Return": SQL execution, result comparison, TypeScript test running. No DOM.
const ENGINE = (() => {
  let dbCounter = 0;

  function makeDB(alasql, schema) {
    const name = 'quiz' + (++dbCounter);
    const db = new alasql.Database(name);
    for (const [table, def] of Object.entries(schema)) {
      db.exec('CREATE TABLE ' + table + ' (' + def.cols.map(c => c[0] + ' ' + c[1]).join(', ') + ')');
      db.exec('INSERT INTO ' + table + ' SELECT * FROM ?', [def.rows.map(r => ({ ...r }))]);
    }
    return { db, dispose() { try { delete alasql.databases[name]; } catch (e) { /* ignore */ } } };
  }

  // Returns { ok, rows, cols, error }. Only a single SELECT statement is allowed.
  function runSQL(alasql, schema, sql) {
    const cleaned = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/;+\s*$/, '');
    if (!cleaned) return { ok: false, error: 'Write a query first.' };
    if (cleaned.includes(';')) return { ok: false, error: 'Run one statement at a time.' };
    if (!/^select\b/i.test(cleaned)) return { ok: false, error: 'Only SELECT queries are allowed in this quiz.' };
    const handle = makeDB(alasql, schema);
    try {
      const rows = handle.db.exec(cleaned);
      if (!Array.isArray(rows)) return { ok: false, error: 'The query did not return rows.' };
      const cols = rows.length ? Object.keys(rows[0]) : [];
      return { ok: true, rows, cols };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e).split('\n')[0] };
    } finally {
      handle.dispose();
    }
  }

  const normCell = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v == null ? null : typeof v === 'string' ? v : String(v));
  const toMatrix = rows => rows.map(r => Object.values(r).map(normCell));
  const key = row => JSON.stringify(row);

  // Compare a learner result with the expected result. Column names are ignored, positions matter.
  function compareSQL(got, want, ordered) {
    if (got.cols.length === 0 && got.rows.length === 0 && want.rows.length > 0) {
      return { ok: false, message: 'Your query returned no rows. The expected result has ' + want.rows.length + '.' };
    }
    if (want.rows.length === 0) {
      return got.rows.length === 0 ? { ok: true } : { ok: false, message: 'Expected no rows, got ' + got.rows.length + '.' };
    }
    if (got.cols.length !== want.cols.length) {
      return { ok: false, message: 'Expected ' + want.cols.length + ' column' + (want.cols.length === 1 ? '' : 's') + ' (' + want.cols.join(', ') + '), got ' + got.cols.length + '.' };
    }
    const a = toMatrix(got.rows), b = toMatrix(want.rows);
    if (a.length !== b.length) {
      return { ok: false, message: 'Expected ' + b.length + ' row' + (b.length === 1 ? '' : 's') + ', got ' + a.length + '.' };
    }
    const sa = a.map(key).sort(), sb = b.map(key).sort();
    const sameSet = sa.every((v, i) => v === sb[i]);
    if (!sameSet) return { ok: false, message: 'The row count is right but some values differ. Check your filter, join or rounding.' };
    if (ordered && !a.every((r, i) => key(r) === key(b[i]))) {
      return { ok: false, message: 'The right rows, in the wrong order. Check your ORDER BY.' };
    }
    return { ok: true };
  }

  // Runs in a Web Worker (or on the main thread as a fallback). Must be self-contained: it is stringified.
  function runTestsCore(payload) {
    function deepEqual(a, b) {
      if (Object.is(a, b) || a === b) return true;
      if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
      const ka = Object.keys(a), kb = Object.keys(b);
      return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
    }
    function show(v) {
      if (v === undefined) return 'undefined';
      if (typeof v === 'function') return '[function]';
      try {
        const s = JSON.stringify(v, (k, x) => (x === undefined ? '__undef__' : typeof x === 'number' && !isFinite(x) ? String(x) : x));
        return s === undefined ? String(v) : s.replace(/"__undef__"/g, 'undefined');
      } catch (e) { return String(v); }
    }
    let fn;
    try {
      fn = new Function(payload.code + '\n;return typeof ' + payload.fnName + " === 'function' ? " + payload.fnName + ' : undefined;')();
    } catch (e) {
      return { fatal: String((e && e.message) || e) };
    }
    if (!fn) return { fatal: 'Define a function named ' + payload.fnName + '.' };
    const results = payload.tests.map(t => {
      try {
        const got = new Function('fn', '"use strict"; return (' + t.call + ');')(fn);
        const want = new Function('return (' + t.expected + ');')();
        return { pass: deepEqual(got, want), received: show(got) };
      } catch (e) {
        return { pass: false, error: String((e && e.message) || e) };
      }
    });
    return { results };
  }

  return { runSQL, compareSQL, runTestsCore, makeDB };
})();
if (typeof module !== 'undefined') module.exports = ENGINE;

function startApp(QUIZ) {
  'use strict';

  const BABEL_SRC = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js';
  const STORE_KEY = 'select-and-return:v2';
  const TYPE_LABEL = { INT: 'int', STRING: 'text', NUMBER: 'decimal' };
  const SQL_STARTER = '-- Write your query here\nSELECT ';

  const QUESTIONS = QUIZ.QUESTIONS;
  const byId = id => QUESTIONS.find(q => q.id === id);
  // Pages that are not questions. They live in the sidebar above the question lists.
  const PAGES = { welcome: { title: 'Welcome', icon: '◇' }, tutorial: { title: 'How it works', icon: '?' } };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- state ----------
  function load() {
    const base = { current: 'welcome', last: null, status: {}, drafts: {} };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const known = id => !!(byId(id) || PAGES[id]);
        return { current: known(p.current) ? p.current : base.current, last: byId(p.last) ? p.last : null, status: p.status || {}, drafts: p.drafts || {} };
      }
    } catch (e) { /* storage unavailable */ }
    return base;
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  const state = load();
  const ui = { outputs: {}, hint: {}, reveal: {}, armed: {}, table: QUIZ.SCHEMA.books ? 'books' : Object.keys(QUIZ.SCHEMA)[0], expected: {}, resetArmed: false };

  let evalOk = true;
  try { new Function('return 1')(); } catch (e) { evalOk = false; }

  const draftFor = q => (state.drafts[q.id] != null ? state.drafts[q.id] : q.starter || SQL_STARTER);

  function markSolved(q) {
    if (state.status[q.id] !== 'revealed') state.status[q.id] = 'solved';
    save(); renderNav(); renderProgress();
  }

  // ---------- rail: progress + nav ----------
  const pad = n => String(n).padStart(2, '0');
  function renderProgress() {
    const total = QUESTIONS.length;
    const solved = QUESTIONS.filter(q => state.status[q.id] === 'solved').length;
    const viewed = QUESTIONS.filter(q => state.status[q.id] === 'revealed').length;
    const pct = total ? Math.round((solved / total) * 100) : 0;
    const left = total - solved - viewed;
    $('#progress').innerHTML =
      '<div class="ring" style="--p:' + pct + '" role="img" aria-label="' + solved + ' of ' + total + ' questions solved"><span>' + pct + '<small>%</small></span></div>' +
      '<div class="progress-text"><strong>' + solved + ' / ' + total + '</strong><span>solved' + (viewed ? ' · ' + viewed + ' viewed' : '') + (left ? ' · ' + left + ' to go' : '') + '</span></div>';
  }

  function renderNav() {
    const item = (id, lead, title, st, level) =>
      '<button type="button" class="nav-item' + (st ? ' is-' + st : '') + '" data-id="' + id + '" aria-current="' + (id === state.current) + '">' +
      '<span class="n" aria-hidden="true">' + lead + '</span><span class="t">' + title + '</span>' +
      '<span class="lv">' + (level ? '<span class="tag">' + esc(level) + '</span>' : '') + '</span>' +
      '<span class="st" aria-hidden="true"></span></button>';
    const start = '<section><h3><span>Start</span></h3><div class="nav-list">' +
      Object.entries(PAGES).map(([id, pg]) => item(id, pg.icon, pg.title, '', '')).join('') + '</div></section>';
    $('#nav').innerHTML = start + QUIZ.TRACKS.map(([track, name]) => {
      const list = QUESTIONS.filter(q => q.track === track);
      if (!list.length) return '';
      const done = list.filter(q => state.status[q.id] === 'solved').length;
      return '<section><h3><span>' + name + '</span><span>' + done + '/' + list.length + '</span></h3><div class="nav-list">' +
        list.map((q, i) => {
          const st = state.status[q.id];
          const label = esc(q.title) + (st === 'solved' ? '<span class="sr-only"> (solved)</span>' : st === 'revealed' ? '<span class="sr-only"> (solution viewed)</span>' : '');
          return item(q.id, pad(i + 1), label, st, q.level);
        }).join('') + '</div></section>';
    }).join('');
  }

  // ---------- helpers for rendering ----------
  function tableHTML(cols, rows, max) {
    max = max || 60;
    const cell = v => (v === null || v === undefined ? '<td class="null">NULL</td>' : typeof v === 'number' ? '<td class="num">' + v + '</td>' : '<td>' + esc(v) + '</td>');
    const isNum = c => { const r = rows.find(x => x[c] != null); return !!r && typeof r[c] === 'number'; };
    const head = cols.map(c => '<th scope="col"' + (isNum(c) ? ' class="num"' : '') + '>' + esc(c) + '</th>').join('');
    const body = rows.slice(0, max).map(r => '<tr>' + cols.map(c => cell(r[c])).join('') + '</tr>').join('');
    return '<div class="tablewrap" tabindex="0"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      (rows.length > max ? '<p class="meta">Showing the first ' + max + ' of ' + rows.length + ' rows.</p>' : '');
  }
  function schemaTableHTML(name) {
    const def = QUIZ.SCHEMA[name];
    const head = def.cols.map(c => '<th scope="col"' + (c[1] === 'STRING' ? '' : ' class="num"') + '>' + esc(c[0]) + '<span class="ty">' + (TYPE_LABEL[c[1]] || c[1]) + '</span></th>').join('');
    const body = def.rows.map(r => '<tr>' + def.cols.map(c => {
      const v = r[c[0]];
      return typeof v === 'number' ? '<td class="num">' + v + '</td>' : '<td>' + esc(v) + '</td>';
    }).join('') + '</tr>').join('');
    return '<div class="tablewrap" tabindex="0"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div><p class="meta">' + name + ' · ' + def.rows.length + ' rows</p>';
  }
  const banner = (kind, label, text) => '<div class="banner ' + kind + '"><strong>' + esc(label) + '</strong><span>' + esc(text) + '</span></div>';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function expectedFor(q) {
    if (!ui.expected[q.id]) ui.expected[q.id] = ENGINE.runSQL(alasql, QUIZ.SCHEMA, q.solution);
    return ui.expected[q.id];
  }

  // ---------- syntax highlighting ----------
  function highlight(code, track) {
    if (!window.hljs) return esc(code);
    try { return window.hljs.highlight(code, { language: track === 'sql' ? 'sql' : 'typescript', ignoreIllegals: true }).value; }
    catch (e) { return esc(code); }
  }
  function syncHL() {
    const ed = $('#editor'), out = $('#editor-hl');
    if (!ed || !out) return;
    // A trailing newline needs a character after it, or the last empty line collapses.
    out.innerHTML = highlight(ed.value, byId(state.current).track) + (ed.value.endsWith('\n') ? ' ' : '');
    const lines = ed.value.split('\n').length;
    const gutter = $('#gutter-lines');
    if (gutter && gutter.childElementCount !== lines) {
      gutter.innerHTML = Array.from({ length: lines }, (_, i) => '<span>' + (i + 1) + '</span>').join('');
    }
    const lc = $('#line-count');
    if (lc) lc.textContent = plural(lines, 'line');
    syncScroll();
    syncCursor();
  }
  function syncScroll() {
    const ed = $('#editor'), pre = $('.editor-hl'), gutter = $('.gutter');
    if (!ed) return;
    if (pre) { pre.scrollTop = ed.scrollTop; pre.scrollLeft = ed.scrollLeft; }
    if (gutter) gutter.scrollTop = ed.scrollTop;
    syncCursor();
  }
  // Status bar position plus the highlighted current line, like a code editor.
  function syncCursor() {
    const ed = $('#editor'), bar = $('#active-line'), pos = $('#cursor-pos');
    if (!ed || !bar) return;
    const before = ed.value.slice(0, ed.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    if (pos) pos.textContent = 'Ln ' + line + ', Col ' + col;
    const cs = getComputedStyle(ed);
    const lh = parseFloat(cs.lineHeight), padTop = parseFloat(cs.paddingTop);
    bar.style.height = lh + 'px';
    bar.style.transform = 'translateY(' + (padTop + (line - 1) * lh - ed.scrollTop) + 'px)';
    const g = $('#gutter-lines');
    if (g) {
      const prev = g.querySelector('.cur');
      if (prev) prev.classList.remove('cur');
      if (g.children[line - 1]) g.children[line - 1].classList.add('cur');
    }
  }

  // ---------- question view: brief on the left, workbench on the right ----------
  function panelHTML(q) {
    const isSql = q.track === 'sql';
    const list = QUESTIONS.filter(x => x.track === q.track);
    const num = list.indexOf(q) + 1;
    const idx = QUESTIONS.indexOf(q);
    const prev = QUESTIONS[idx - 1], next = QUESTIONS[idx + 1];
    const st = state.status[q.id];

    let brief = '<header class="q-head"><div class="eyebrow"><span class="track">' + (isSql ? 'SQL' : 'TS') + '</span><span>' + pad(num) + ' / ' + pad(list.length) + '</span>' +
      '<span class="tag">' + esc(q.level) + '</span>' +
      (st === 'solved' ? '<span class="tag solved">Solved</span>' : st === 'revealed' ? '<span class="tag revealed">Viewed</span>' : '') + '</div>' +
      '<h2 id="q-title" tabindex="-1">' + esc(q.title) + '</h2></header>';
    brief += '<div class="prompt">' + q.prompt + '</div>';

    if (isSql) {
      const exp = expectedFor(q);
      if (exp.ok) {
        brief += '<div class="section"><div class="label"><span>Target</span></div><p class="target">' + plural(exp.cols.length, 'column') + ' (<code>' + exp.cols.map(esc).join('</code>, <code>') + '</code>) and ' + plural(exp.rows.length, 'row') + '.</p>' +
          '<details class="expected"><summary>Show the expected result</summary>' + tableHTML(exp.cols, exp.rows) + '</details></div>';
      }
      const tables = Object.keys(QUIZ.SCHEMA);
      if (tables.length) brief += '<div class="section"><div class="label"><span>Tables</span><span class="aside">Same data for every SQL question</span></div>' +
        '<div class="chips" role="group" aria-label="Tables">' + tables.map(t => '<button type="button" class="chip" data-table="' + t + '" aria-pressed="' + (t === ui.table) + '">' + t + '</button>').join('') + '</div>' +
        '<div id="schema">' + schemaTableHTML(ui.table) + '</div></div>';
    } else {
      const hidden = q.tests.filter(t => !t.visible).length;
      brief += '<div class="section"><div class="label"><span>Function</span></div><p class="fn-sig">Define <code>' + esc(q.fnName) + '</code>. It runs against ' + plural(q.tests.length, 'test') + (hidden ? ', ' + hidden + ' of them hidden' : '') + '.</p></div>';
      // Example calls, taken from the visible tests that call the function directly.
      // Example calls: the question's own "examples" if it has them, otherwise its visible tests.
      const examples = q.examples || q.tests
        .filter(t => t.visible && /^\s*fn\(/.test(t.call))
        .map(t => ({ call: t.call, returns: t.expected }));
      if (examples.length) {
        const src = examples.map(e => e.call.replace(/^\s*fn\(/, q.fnName + '(') + (e.returns != null ? '\n// → ' + e.returns : '')).join('\n\n');
        brief += '<div class="section"><div class="label"><span>Example</span><span class="aside">' + (examples.length === 1 ? 'Called like this' : 'Called like these') + '</span></div>' +
          '<pre class="example"><code>' + highlight(src, 'ts') + '</code></pre></div>';
      }
    }

    if (ui.armed[q.id] && !ui.reveal[q.id]) brief += '<div class="note"><strong>Heads up.</strong> Viewing the solution marks this question as viewed instead of solved.</div>';
    if (ui.hint[q.id]) brief += '<div class="note hint"><strong>Hint.</strong> ' + esc(q.hint) + '</div>';
    if (ui.reveal[q.id]) {
      brief += '<div class="section"><div class="sol-head"><div class="label">Reference solution</div><button type="button" class="btn" data-action="load-solution">Load into editor</button></div><pre><code>' + highlight(q.solution, q.track) + '</code></pre></div>';
    }
    brief += '<div class="pager"><button type="button" class="btn" data-action="prev">← ' + (prev ? esc(prev.title) : 'How it works') + '</button>' +
      '<button type="button" class="btn" data-action="next"' + (next ? '' : ' disabled') + '>' + (next ? esc(next.title) : 'Next') + ' →</button></div>';

    const rows = isSql ? 11 : Math.max(13, q.starter.split('\n').length + 4);
    const runKey = '<span class="k">⌘↵</span>';
    let work = '<div class="win"><div class="win-bar"><span class="win-tab">' + (isSql ? 'query.sql' : 'solution.ts') + '</span><span class="spacer"></span>' +
      (q.hint ? '<button type="button" class="btn tool' + (ui.hint[q.id] ? ' on' : '') + '" data-action="hint">' + (ui.hint[q.id] ? 'Hide hint' : 'Hint') + '</button>' : '') +
      '<button type="button" class="btn tool' + (ui.armed[q.id] ? ' armed' : '') + (ui.reveal[q.id] ? ' on' : '') + '" data-action="reveal">' + (ui.reveal[q.id] ? 'Hide solution' : ui.armed[q.id] ? 'Click again to show' : 'Solution') + '</button>' +
      '<button type="button" class="btn tool" data-action="reset">Reset</button></div>' +
      '<div class="editor-wrap"><div class="gutter" aria-hidden="true"><div id="gutter-lines"></div></div>' +
      '<div class="code"><div class="active-line" id="active-line" aria-hidden="true"></div><pre class="editor-hl" aria-hidden="true"><code id="editor-hl"></code></pre>' +
      '<textarea id="editor" class="editor" rows="' + rows + '" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="' + (isSql ? 'SQL query' : 'TypeScript solution') + '"></textarea></div></div>' +
      '<div class="statusbar" aria-hidden="true"><span id="cursor-pos">Ln 1, Col 1</span><span id="line-count"></span><span class="spacer"></span><span>Spaces: 2</span><span>UTF-8</span><span>' + (isSql ? 'SQL' : 'TypeScript') + '</span></div>' +
      '<div class="win-foot">' +
      (isSql
        ? '<button type="button" class="btn" data-action="run">Run' + runKey + '</button><button type="button" class="btn primary" data-action="submit">Submit answer</button>'
        : '<button type="button" class="btn primary" data-action="tests">Run tests' + runKey + '</button>') +
      '<span class="keys"><kbd>Tab</kbd> indents · <kbd>Esc</kbd> <kbd>Tab</kbd> leaves</span></div></div>';
    work += '<div class="console"><div class="console-head">Output</div><div class="out" id="out" role="status" aria-live="polite" data-empty="' +
      (isSql ? 'Run your query to see its result here.' : 'Run the tests to see the results here.') + '">' + (ui.outputs[q.id] || '') + '</div></div>';

    return '<div class="q"><section class="q-brief">' + brief + '</section><section class="q-work" aria-label="Editor">' + work + '</section></div>';
  }

  // ---------- welcome + tutorial pages ----------
  const firstOpen = list => list.find(q => !state.status[q.id]) || list[0];

  function welcomeHTML() {
    const started = Object.keys(state.status).length > 0 || Object.keys(state.drafts).length > 0;
    const last = byId(state.last);
    const firstQ = QUESTIONS[0];
    const demo = "SELECT title, price\nFROM books\nWHERE price > 15\nORDER BY price DESC;";

    let html = '<div class="welcome"><section class="hero"><div class="hero-copy">' +
      '<h2 id="q-title" tabindex="-1">Write it. Run it. <em>Return the right data.</em></h2>' +
      '<div class="actions">' +
      (started && last
        ? '<button type="button" class="btn primary" data-go="' + last.id + '">Continue: ' + esc(last.title) + ' →</button>'
        : firstQ ? '<button type="button" class="btn primary" data-go="' + firstQ.id + '">Start the first question →</button>' : '') +
      '<button type="button" class="btn" data-go="tutorial">How it works</button></div></div>' +
      '<div class="hero-demo" aria-hidden="true"><div class="win"><div class="win-bar"><span class="win-tab">query.sql</span></div>' +
      '<pre><code>' + highlight(demo, 'sql') + '<span class="caret"></span></code></pre>' +
      '<div class="demo-result">✓ Correct · matches the expected result</div></div></div></section>';

    html += '<div class="cards">' + QUIZ.TRACKS.map(([track, name]) => {
      const list = QUESTIONS.filter(q => q.track === track);
      if (!list.length) return '';
      const done = list.filter(q => state.status[q.id] === 'solved').length;
      const pct = Math.round((done / list.length) * 100);
      const levels = [...new Set(list.map(q => q.level))].join(' · ');
      const blurb = track === 'sql'
        ? 'Query a small bookshop database: authors, books, customers and orders.'
        : 'Write small functions, checked by visible and hidden tests.';
      return '<div class="card card-box"><span class="card-num" aria-hidden="true">' + pad(list.length) + '</span>' +
        '<div class="eyebrow"><span class="track">' + (track === 'sql' ? 'SQL' : 'TS') + '</span><span>' + plural(list.length, 'question') + '</span></div>' +
        '<h3>' + name + '</h3><p>' + blurb + '</p>' +
        '<div class="bar" role="img" aria-label="' + done + ' of ' + list.length + ' solved"><i style="--p:' + pct + '"></i></div>' +
        '<p class="meta">' + done + ' of ' + list.length + ' solved · ' + esc(levels) + '</p>' +
        '<button type="button" class="btn" data-go="' + firstOpen(list).id + '">' + (done ? 'Continue ' : 'Start ') + name + ' →</button></div>';
    }).join('') + '</div>';

    html += '<p class="credits">A quiz made by <strong>Lucian</strong>, <strong>Fu.F</strong> &amp; <strong>Lexi</strong></p>';
    html += '</div>';
    return html;
  }

  function tutorialHTML() {
    const step = (n, title, body) => '<li class="step"><span class="step-n" aria-hidden="true">' + pad(n) + '</span><div><h3>' + title + '</h3>' + body + '</div></li>';
    const code = (src, track) => '<pre><code>' + highlight(src, track) + '</code></pre>';
    const sqlExample = QUIZ.SCHEMA.authors
      ? "SELECT name, country\nFROM authors\nWHERE country = 'UK'\nORDER BY name"
      : 'SELECT *\nFROM ' + (Object.keys(QUIZ.SCHEMA)[0] || 'my_table') + '\nLIMIT 3';
    const tsExample = 'function double(n: number): number {\n  return n * 2;\n}\n';
    const firstQ = QUESTIONS[0];

    let html = '<div class="tut"><header class="tut-head"><div class="eyebrow"><span class="track">TUTORIAL</span><span>About two minutes</span></div>' +
      '<h2 id="q-title" tabindex="-1">How it works</h2>' +
      '<p class="lede">Every question works the same way: read what it wants, write an answer, check it.</p></header><ol class="steps">';

    html += step(1, 'Pick a question',
      '<p>The sidebar lists every question, grouped into SQL and TypeScript. The dot next to each one turns <strong style="color:var(--ok)">green</strong> when you solve it, or <strong style="color:var(--warn)">amber</strong> if you looked at the solution first.</p>');

    html += step(2, 'SQL: read, query, submit',
      '<p>Every SQL question uses the same tables. Click a table name to look at its data. <strong>Target</strong> tells you how many columns and rows the answer has, and you can peek at the expected result.</p>' +
      '<p>Try it with this example query:</p>' + code(sqlExample, 'sql') +
      '<div class="actions"><button type="button" class="btn" data-action="tut-run">Run this example</button></div>' +
      '<div class="out" id="tut-out" role="status" aria-live="polite"></div>' +
      '<p><strong>Run</strong> only shows your result. <strong>Submit answer</strong> compares it with the expected result. Column names don\'t matter, but column order, values and (when the question asks for a sort) row order do. Numbers are compared to 2 decimals.</p>');

    html += step(3, 'TypeScript: write the function, run the tests',
      '<p>Each TypeScript question names the function to write, and the editor starts with its signature. For example:</p>' + code(tsExample, 'ts') +
      '<p><strong>Run tests</strong> calls your function with several inputs. Some tests show their input and expected output; hidden tests only say pass or fail.</p>' +
      '<ul class="tests">' +
        '<li class="test"><span class="pill pass">Pass</span><div><div class="what">doubles a positive number</div><dl><dt>call</dt><dd>fn(4)</dd></dl></div></li>' +
        '<li class="test"><span class="pill fail">Fail</span><div><div class="what">doubles a negative number</div><dl><dt>call</dt><dd>fn(-3)</dd><dt>expected</dt><dd>-6</dd><dt>received</dt><dd>6</dd></dl></div></li>' +
        '<li class="test"><span class="pill pass">Pass</span><div><div class="what">zero <span class="tag-hidden">· hidden test</span></div></div></li>' +
      '</ul>');

    html += step(4, 'Stuck?',
      '<p><strong>Hint</strong> gives a nudge without the answer. <strong>Solution</strong> needs a second click to confirm, and marks the question as viewed instead of solved. <strong>Reset</strong> puts the starter code back.</p>');

    html += step(5, 'Keyboard',
      '<p><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd> runs the query or the tests. <kbd>Tab</kbd> indents inside the editor; press <kbd>Esc</kbd> then <kbd>Tab</kbd> to move on.</p>');

    html += step(6, 'Your progress',
      '<p>Solved questions and everything you type are saved in this browser automatically. <strong>Reset progress</strong> at the bottom of the sidebar clears it all.</p>');

    html += '</ol><div class="pager"><button type="button" class="btn" data-go="welcome">← Welcome</button>' +
      (firstQ ? '<button type="button" class="btn primary" data-go="' + firstQ.id + '">Start: ' + esc(firstQ.title) + ' →</button>' : '') + '</div></div>';
    return html;
  }

  function runTutorialExample() {
    const out = $('#tut-out');
    const src = $('.step pre code') ? $('.step pre code').textContent : '';
    if (!evalOk || typeof alasql === 'undefined') { out.innerHTML = banner('bad', 'Cannot run', 'The SQL engine is not available here.'); return; }
    const res = ENGINE.runSQL(alasql, QUIZ.SCHEMA, src);
    out.innerHTML = res.ok
      ? banner('', 'Result', plural(res.rows.length, 'row') + '. On a real question you would now press Submit answer.') + tableHTML(res.cols, res.rows)
      : banner('bad', 'Error', res.error);
  }

  function renderPanel(focusTitle) {
    const panel = $('#panel');
    // Play the entrance animation on navigation only, not when a hint or solution toggles.
    panel.classList.toggle('enter', !!focusTitle || !panel.dataset.ready);
    panel.dataset.ready = '1';
    if (PAGES[state.current]) {
      panel.innerHTML = state.current === 'welcome' ? welcomeHTML() : tutorialHTML();
      if (focusTitle) {
        $('#q-title').focus({ preventScroll: true });
        if (window.matchMedia('(max-width: 860px)').matches) panel.scrollIntoView({ block: 'start' });
      }
      return;
    }
    const q = byId(state.current);
    panel.innerHTML = panelHTML(q);
    const ed = $('#editor');
    ed.value = draftFor(q);
    ed.addEventListener('scroll', syncScroll);
    ['keyup', 'click', 'select', 'focus'].forEach(ev => ed.addEventListener(ev, syncCursor));
    syncHL();
    if (q.track === 'ts') loadBabel().catch(() => {});
    if (focusTitle) {
      $('#q-title').focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 860px)').matches) panel.scrollIntoView({ block: 'start' });
    }
  }

  function setOut(html) {
    const q = byId(state.current);
    ui.outputs[q.id] = html;
    const out = $('#out');
    if (out) out.innerHTML = html;
  }

  // ---------- running SQL ----------
  function runSql(q, submit) {
    const sql = $('#editor').value;
    if (!evalOk || typeof alasql === 'undefined') {
      setOut(banner('bad', 'Cannot run', typeof alasql === 'undefined' ? 'The SQL engine did not load. Check your connection and reload the page.' : 'This viewer blocks dynamic code, which the SQL engine needs.'));
      return;
    }
    const t0 = performance.now();
    const res = ENGINE.runSQL(alasql, QUIZ.SCHEMA, sql);
    const ms = Math.max(1, Math.round(performance.now() - t0));
    if (!res.ok) { setOut(banner('bad', 'Error', res.error)); return; }
    const shown = res.rows.length ? tableHTML(res.cols, res.rows) : '';
    const count = plural(res.rows.length, 'row') + ' · ' + ms + ' ms';
    if (!submit) {
      setOut(banner('', 'Result', count + '. Submit when it looks right.') + shown);
      return;
    }
    const exp = expectedFor(q);
    const cmp = ENGINE.compareSQL(res, exp, q.ordered);
    if (cmp.ok) {
      markSolved(q);
      const viewed = state.status[q.id] === 'revealed';
      setOut(banner('ok', 'Correct', plural(res.rows.length, 'row') + ' match the expected result.' + (viewed ? ' (Not counted as solved because you viewed the solution.)' : ' Marked as solved.')) + shown);
    } else {
      setOut(banner('bad', 'Not yet', cmp.message) + shown);
    }
  }

  // ---------- running TypeScript ----------
  let babelPromise = null;
  function loadBabel() {
    if (window.Babel) return Promise.resolve();
    if (!babelPromise) {
      babelPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = BABEL_SRC;
        s.onload = () => resolve();
        s.onerror = () => { babelPromise = null; reject(new Error('Could not load the TypeScript compiler.')); };
        document.head.appendChild(s);
      });
    }
    return babelPromise;
  }

  const WORKER_SRC = 'const runTestsCore = ' + ENGINE.runTestsCore.toString() + ';\nonmessage = function (e) { postMessage(runTestsCore(e.data)); };';
  function execTests(payload) {
    return new Promise(resolve => {
      let w = null, url = null, timer = null, done = false;
      const finish = r => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { if (w) w.terminate(); } catch (e) { /* ignore */ }
        try { if (url) URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        resolve(r);
      };
      try {
        url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
        w = new Worker(url);
        w.onmessage = e => finish(e.data);
        w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); finish(ENGINE.runTestsCore(payload)); };
        timer = setTimeout(() => finish({ timeout: true }), 3000);
        w.postMessage(payload);
      } catch (e) {
        finish(ENGINE.runTestsCore(payload));
      }
    });
  }

  let running = false;
  async function runTs(q) {
    if (running) return;
    running = true;
    const btn = $('[data-action="tests"]');
    if (btn) btn.disabled = true;
    try {
      if (!evalOk) { setOut(banner('bad', 'Cannot run', 'This viewer blocks dynamic code, which running your function needs.')); return; }
      if (!window.Babel) {
        setOut(banner('', 'Loading', 'Fetching the TypeScript compiler…'));
        try { await loadBabel(); } catch (e) { setOut(banner('bad', 'Cannot run', e.message + ' Check your connection and try again.')); return; }
      }
      let code;
      try {
        code = window.Babel.transform($('#editor').value, { presets: ['typescript'], filename: 'solution.ts' }).code;
      } catch (e) {
        const msg = String(e.message || e).replace(/^\/?solution\.ts: /, '');
        const [first, ...rest] = msg.split('\n');
        setOut(banner('bad', 'Syntax error', first) + (rest.join('\n').trim() ? '<pre>' + esc(rest.join('\n').trim()) + '</pre>' : ''));
        return;
      }
      const res = await execTests({ code, fnName: q.fnName, tests: q.tests.map(t => ({ call: t.call, expected: t.expected })) });
      if (res.timeout) { setOut(banner('bad', 'Timed out', 'Your function ran for more than 3 seconds. Look for a loop that never ends.')); return; }
      if (res.fatal) { setOut(banner('bad', 'Error', res.fatal)); return; }
      const passed = res.results.filter(r => r.pass).length;
      const all = passed === q.tests.length;
      let head;
      if (all) {
        markSolved(q);
        const viewed = state.status[q.id] === 'revealed';
        head = banner('ok', 'All ' + q.tests.length + ' tests passed', viewed ? 'Not counted as solved because you viewed the solution.' : 'Marked as solved.');
      } else {
        head = banner('bad', passed + ' of ' + q.tests.length + ' tests passed', 'Fix the failing cases below and run again.');
      }
      const items = q.tests.map((t, i) => {
        const r = res.results[i];
        let inner = '<div class="what">' + esc(t.label) + (t.visible ? '' : ' <span class="tag-hidden">· hidden test</span>') + '</div>';
        if (t.visible && !r.pass) {
          inner += '<dl><dt>call</dt><dd>' + esc(t.call) + '</dd><dt>expected</dt><dd>' + esc(t.expected) + '</dd><dt>received</dt><dd>' + esc(r.error ? 'threw an error' : r.received) + '</dd></dl>';
        } else if (t.visible) {
          inner += '<dl><dt>call</dt><dd>' + esc(t.call) + '</dd></dl>';
        }
        if (r.error) inner += '<div class="err">' + esc(r.error) + '</div>';
        return '<li class="test"><span class="pill ' + (r.pass ? 'pass' : 'fail') + '">' + (r.pass ? 'Pass' : 'Fail') + '</span><div>' + inner + '</div></li>';
      }).join('');
      setOut(head + '<ul class="tests">' + items + '</ul>');
    } finally {
      running = false;
      const b = $('[data-action="tests"]');
      if (b) b.disabled = false;
    }
  }

  // ---------- events ----------
  function go(id, focusTitle) {
    state.current = id;
    if (byId(id)) state.last = id;
    try { history.replaceState(null, '', '#' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
    save();
    renderNav();
    renderPanel(focusTitle);
  }

  // The brand in the sidebar header goes back to the welcome page.
  $('#brand-link').addEventListener('click', e => {
    e.preventDefault();
    go('welcome', true);
  });

  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('[data-id]');
    if (b) go(b.getAttribute('data-id'), true);
  });

  $('#panel').addEventListener('click', e => {
    const chip = e.target.closest('[data-table]');
    if (chip) {
      ui.table = chip.getAttribute('data-table');
      document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
      $('#schema').innerHTML = schemaTableHTML(ui.table);
      return;
    }
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) { go(goBtn.getAttribute('data-go'), true); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.getAttribute('data-action') === 'tut-run') { runTutorialExample(); return; }
    const q = byId(state.current);
    if (!q) return;
    const idx = QUESTIONS.indexOf(q);
    switch (btn.getAttribute('data-action')) {
      case 'run': runSql(q, false); break;
      case 'submit': runSql(q, true); break;
      case 'tests': runTs(q); break;
      case 'hint': ui.hint[q.id] = !ui.hint[q.id]; keepEditor(q); break;
      case 'reveal':
        if (ui.reveal[q.id]) { ui.reveal[q.id] = false; ui.armed[q.id] = false; }
        else if (ui.armed[q.id]) {
          ui.reveal[q.id] = true;
          if (state.status[q.id] !== 'solved') state.status[q.id] = 'revealed';
          save(); renderNav(); renderProgress();
        } else ui.armed[q.id] = true;
        keepEditor(q);
        break;
      case 'load-solution':
        state.drafts[q.id] = q.solution; save();
        $('#editor').value = q.solution;
        syncHL();
        $('#editor').focus();
        break;
      case 'reset':
        delete state.drafts[q.id]; save();
        $('#editor').value = draftFor(q);
        syncHL();
        ui.outputs[q.id] = ''; $('#out').innerHTML = '';
        break;
      case 'prev': go(QUESTIONS[idx - 1] ? QUESTIONS[idx - 1].id : 'tutorial', true); break;
      case 'next': if (QUESTIONS[idx + 1]) go(QUESTIONS[idx + 1].id, true); break;
    }
  });

  // Re-render the panel but keep what the learner has typed.
  function keepEditor(q) {
    const val = $('#editor').value;
    state.drafts[q.id] = val; save();
    renderPanel(false);
  }

  let tabEscape = false;
  $('#panel').addEventListener('input', e => {
    if (e.target.id === 'editor') { state.drafts[state.current] = e.target.value; save(); syncHL(); }
  });
  $('#panel').addEventListener('keydown', e => {
    if (e.target.id !== 'editor') return;
    const q = byId(state.current);
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (q.track === 'sql') runSql(q, false); else runTs(q);
      return;
    }
    if (e.key === 'Escape') { tabEscape = true; return; }
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (tabEscape) { tabEscape = false; return; }
      e.preventDefault();
      const ed = e.target;
      ed.setRangeText('  ', ed.selectionStart, ed.selectionEnd, 'end');
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (e.key !== 'Shift') {
      tabEscape = false;
    }
  });

  $('#reset-all').addEventListener('click', e => {
    const b = e.currentTarget;
    if (!ui.resetArmed) { ui.resetArmed = true; b.classList.add('armed'); b.textContent = 'Click again to erase all progress and drafts'; return; }
    ui.resetArmed = false; b.classList.remove('armed'); b.textContent = 'Reset progress';
    state.status = {}; state.drafts = {};
    ui.outputs = {}; ui.hint = {}; ui.reveal = {}; ui.armed = {};
    save(); renderNav(); renderProgress(); renderPanel(false);
  });

  // ---------- boot ----------
  QUIZ.TRACKS.forEach(([t]) => { if (!QUESTIONS.some(q => q.track === t)) $('#note-' + t).hidden = true; });
  if (QUIZ.problems.length) {
    const w = document.createElement('div');
    w.className = 'banner bad';
    w.innerHTML = '<strong>Data files</strong><span>' + QUIZ.problems.map(esc).join('<br>') + '</span>';
    $('#alerts').appendChild(w);
  }
  if (!QUESTIONS.length) { $('#panel').innerHTML = '<p>No questions yet. Add some to questions.json.</p>'; return; }
  // A link such as page.html#tutorial or page.html#sql-pricey-books opens that page directly.
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (byId(fromHash) || PAGES[fromHash]) state.current = fromHash;
  renderProgress();
  renderNav();
  renderPanel(false);
  if (typeof alasql === 'undefined' || !evalOk) {
    const w = document.createElement('div');
    w.className = 'banner warn';
    w.innerHTML = '<strong>Limited</strong><span>' + (typeof alasql === 'undefined' ? 'The SQL engine did not load, so queries cannot run. Reload the page or check your connection.' : 'This viewer blocks dynamic code, so queries and tests cannot run here.') + '</span>';
    $('#alerts').appendChild(w);
  }
}

// Boot: load the JSON files, then start. Errors are shown on the page instead of a blank panel.
function loadJSON(url) {
  return fetch(url, { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status + '.');
      return r.text();
    })
    .then(text => {
      try { return JSON.parse(text); }
      catch (e) { throw new Error(url + ' is not valid JSON: ' + e.message); }
    });
}
const pageLoaded = new Promise(r => (document.readyState === 'complete' ? r() : window.addEventListener('load', r, { once: true })));
const fontsLoaded = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
function hideLoading() {
  const el = document.getElementById('page-loading');
  if (!el) return;
  el.classList.add('done');
  setTimeout(() => el.remove(), 250);
}
Promise.all([loadJSON(QUESTIONS_URL), loadJSON(SCHEMA_URL), pageLoaded, fontsLoaded])
  .then(([list, schema]) => startApp(buildQuiz(list, schema)))
  .catch(e => {
    const msg = location.protocol === 'file:'
      ? 'Could not load ' + QUESTIONS_URL + ' and ' + SCHEMA_URL + '. Browsers block this for pages opened from disk, so serve the folder with a web server.'
      : String(e.message || e);
    const w = document.createElement('div');
    w.className = 'banner bad';
    w.innerHTML = '<strong>Questions</strong><span></span>';
    w.querySelector('span').textContent = msg;
    document.getElementById('alerts').appendChild(w);
  })
  .finally(hideLoading);
