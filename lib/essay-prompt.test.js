const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.MAGNET_DB = path.join(os.tmpdir(), `magnet-essay-prompt-${process.pid}.sqlite`);
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-ep-${process.pid}`);

const { buildEssayPrompt, leftoverBlock } = require('./essay-prompt');
const { historyBlock } = require('./cascade');

test('autofill empty instruction still means write the fields', () => {
  const { prompt } = buildEssayPrompt({
    fields: [{ id: 'a', label: 'Why this role', current: '' }],
    company: 'Acme',
    title: 'FE',
    jd: { text: 'Build tools' },
    bodies: [],
    voice: 'Be short.',
  });
  assert.match(prompt, /No user message\. Write listed empty fields/);
  assert.match(prompt, /Return JSON only after Stage 4/);
  assert.match(prompt, /## Stage 1 Strategy/);
  assert.doesNotMatch(prompt, /Mode: discuss/);
  assert.doesNotMatch(prompt, /there is no mode/);
});

test('chat instruction has no mode and leftoverBlock can include review extras', () => {
  const { prompt } = buildEssayPrompt({
    instruction: 'what should I write here',
    fields: [{ id: 'a', label: 'Why this role', current: '' }],
    leftovers: [{ id: 'age1', label: 'What is your age range?', options: [], residual: 'red' }],
    review_fills: [{ id: 'tw', label: 'Twitter', value: 'https://x.com/x', reason: 'from profile' }],
    review_asks: [{ id: 'gh', question: 'GitHub URL?', why: 'empty' }],
    company: 'Acme',
    title: 'FE',
    bodies: [],
    voice: 'Be short.',
  });
  assert.match(prompt, /there is no mode/);
  assert.match(prompt, /Do not paste opinions/);
  assert.match(prompt, /Leftover review already returned/);
});

test('leftover age bubbles with empty options are called out', () => {
  const block = leftoverBlock({
    profile_age: 30,
    leftovers: [{ id: 'age1', label: 'What is your age range?', options: [], residual: 'red' }],
  });
  assert.match(block, /not scraped/);
  assert.match(block, /Profile age on file: 30/);
  assert.match(block, /age1/);
  assert.match(block, /Do not paste opinions/);
});

test('chat history stays on the one-call prompt', () => {
  const { prompt } = buildEssayPrompt({
    instruction: 'what does inspect the query actually mean?',
    company: 'Metabase',
    title: 'Frontend',
    bodies: [],
    voice: 'Be short.',
    history: [
      { role: 'you', text: 'idk, read their marketing' },
      { role: 'magnet', text: 'Inspect the query is why this JD felt hot.' },
    ],
  });
  assert.match(prompt, /Recent chat on this job tab/);
  assert.match(prompt, /Inspect the query is why this JD felt hot/);
  assert.match(prompt, /Return JSON only after Stage 4/);
  const old = 'x'.repeat(9000);
  const snippet = historyBlock({
    history: [{ role: 'magnet', text: old }, { role: 'you', text: 'what is this job?' }],
  });
  assert.match(snippet, /what is this job\?/);
  assert.equal(snippet.includes('magnet: xxxxxxxx'), false);
});

test('preferPostingJd prefers a stored homepage JD over a thin hunt stub', () => {
  const { preferPostingJd } = require('./essay-prompt');
  const { writeRecord } = require('./process-store');
  const url = 'https://jobs.example.com/thin-jd';
  const posting =
    'About the role\n\nResponsibilities\nBuild tools for authors and editors.\nRequirements\nReact, TypeScript, and a real shipped product.\n' +
    'The team ships weekly and the posting includes salary, education, and a benefits paragraph so it is not a hunt teaser.';
  writeRecord(url, { jd: { text: posting, source: 'host' } });
  const live = preferPostingJd({
    meta: { url },
    jd: {
      text: 'Principal Front-End, Sunnyvale. Requirements: 5+ years React, TypeScript, Vue. Remote $148k.',
      source: 'hunt',
    },
  });
  assert.equal((live && live.text) || '', posting);
});

test('preferPostingJd keeps stored posting text over an apply-form capture', () => {
  const { preferPostingJd } = require('./essay-prompt');
  const { writeRecord } = require('./process-store');
  const url = 'https://jobs.example.com/prefer-jd';
  const posting =
    'About the role\n\nResponsibilities\nBuild tools for authors and editors.\nRequirements\nReact, TypeScript, and a real shipped product.';
  writeRecord(url, { jd: { text: posting } });
  const live = preferPostingJd({
    meta: { url },
    jd: {
      text: 'Submit application\nAttach resume\nFirst name\nLast name\nEmail\nPhone\nAdditional information\nCurrent location',
    },
  });
  assert.equal((live && live.text) || '', posting);
});
