#!/usr/bin/env node
// Builds the encrypted questions.json the page loads from the plain questions.src.json.
// Run: node build.js
//
// Questions are chained in sidebar order (all SQL first, then all TypeScript).
// The first question opens without a keyword. Every other question is encrypted
// with the keyword of the question before it, so it stays unreadable until that
// one is solved.
//
// The last question hands out one of two final flags: its keyword, or its
// viewedFlag when the player looked at any solution along the way.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CTF = require('./ctf.js');

const SRC = path.join(__dirname, 'questions.src.json');
const OUT = path.join(__dirname, 'questions.json');
const TRACK_ORDER = ['sql', 'ts'];

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

let list;
try {
  list = JSON.parse(fs.readFileSync(SRC, 'utf8'));
} catch (e) {
  fail(e.code === 'ENOENT' ? 'questions.src.json not found. Create it next to build.js (see README).' : 'questions.src.json is not valid JSON: ' + e.message);
}
if (!Array.isArray(list) || !list.length) fail('questions.src.json must be a non-empty array of questions.');

// Catch the mistakes that would only show up after a question is unlocked.
const problems = [];
list.forEach((q, i) => {
  const where = 'Question ' + (i + 1) + (q && q.title ? ' ("' + q.title + '")' : '');
  if (!q || !TRACK_ORDER.includes(q.type)) { problems.push(where + ": type must be 'sql' or 'ts'."); return; }
  for (const f of ['title', 'prompt', 'solution', 'keyword']) if (!q[f]) problems.push(where + ': missing ' + f + '.');
  if (q.keyword != null && !CTF.normKeyword(q.keyword)) problems.push(where + ': keyword is blank.');
  if (q.type === 'ts') {
    if (!q.starter) problems.push(where + ': missing starter.');
    if (!Array.isArray(q.tests) || !q.tests.length) problems.push(where + ': missing tests.');
  }
});
if (problems.length) fail('Fix these first:\n  ' + problems.join('\n  '));

// Same order as the sidebar. The sort is stable, so questions keep their order within a track.
const chain = list.slice().sort((a, b) => TRACK_ORDER.indexOf(a.type) - TRACK_ORDER.indexOf(b.type));

// Players who viewed a solution get this flag instead. When the author leaves it
// out it is made from a hash, so neither flag can be guessed from the other.
const last = chain[chain.length - 1];
const viewedFlag = last.viewedFlag
  ? String(last.viewedFlag)
  : 'flag{viewed-' + crypto.createHash('sha256').update('viewed:' + CTF.normKeyword(last.keyword)).digest('hex').slice(0, 10) + '}';
if (CTF.normKeyword(viewedFlag) === CTF.normKeyword(last.keyword)) fail('The last question\'s viewedFlag must differ from its keyword.');

// Public ids must not give the title away, so they are a short hash of it.
const seen = new Set();
const idFor = q => {
  const base = q.id || q.type + '-' + crypto.createHash('sha256').update(q.title).digest('hex').slice(0, 8);
  let id = base;
  for (let n = 2; seen.has(id); n++) id = base + '-' + n;
  seen.add(id);
  return id;
};

(async () => {
  const questions = [];
  let prevKeyword = '';
  for (const q of chain) {
    // viewedFlag only means something on the last question.
    const { id: _id, viewedFlag: _viewed, ...payload } = q;
    if (q === last) payload.viewedFlag = viewedFlag;
    questions.push({ id: idFor(q), track: q.type, ...(await CTF.seal(payload, prevKeyword)) });
    prevKeyword = q.keyword;
  }
  fs.writeFileSync(OUT, JSON.stringify({ ctf: 1, questions }, null, 2) + '\n');

  console.log('✓ Wrote questions.json with ' + questions.length + ' questions.\n');
  chain.forEach((q, i) => {
    const label = (String(i + 1).padStart(2, ' ') + '. ' + q.type.toUpperCase().padEnd(3) + ' ' + q.title).padEnd(40);
    console.log('  ' + label + (i === chain.length - 1 ? ' final flag: ' : ' keyword: ') + CTF.normKeyword(q.keyword));
  });
  console.log(''.padEnd(42) + ' if a solution was viewed: ' + viewedFlag + (last.viewedFlag ? '' : ' (generated)'));
})().catch(e => fail(String((e && e.stack) || e)));
