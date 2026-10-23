const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-log-'));
process.env.MAGNET_ANSWERS = path.join(dir, 'answers.jsonl');
process.env.MAGNET_DB = path.join(dir, 'magnet.sqlite');
process.env.MAGNET_KNOWLEDGE = dir;
process.env.MAGNET_STORE = 'sqlite';

const { recordEssay, loadLoggedEssays } = require('./essay-log');

test('essay drafts and later finals are logged without a complete action', () => {
  const draft = recordEssay({
    url: 'https://jobs.example.com/a',
    company: 'Example',
    label: 'Why us',
    normalized_key: 'why-us',
    llm_draft: 'I want to build the editor.',
    final: 'I want to build the editor.',
    id: 'field-1',
  });
  assert.equal(draft.origin, 'magnet');
  const edited = recordEssay({
    url: 'https://jobs.example.com/a',
    company: 'Example',
    label: 'Why us',
    normalized_key: 'why-us',
    llm_draft: 'I want to build the editor.',
    final: 'I want to build the editor with the people who ship it.',
    id: 'field-1',
  });
  assert.notEqual(edited.origin, 'magnet');
  const again = recordEssay({
    url: 'https://jobs.example.com/a',
    label: 'Why us',
    llm_draft: 'I want to build the editor.',
    final: 'I want to build the editor with the people who ship it.',
    id: 'field-1',
  });
  assert.equal(again.final, edited.final);
  const lines = fs.readFileSync(process.env.MAGNET_ANSWERS, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(loadLoggedEssays().length, 2);
});

test('a mirror with no url does not write the archive', () => {
  const before = fs.readFileSync(process.env.MAGNET_ANSWERS, 'utf8');
  recordEssay({ label: 'Why', final: 'hello' });
  assert.equal(fs.readFileSync(process.env.MAGNET_ANSWERS, 'utf8'), before);
});

test('harvest and autofill origins do not enter the user-draft log', () => {
  const before = fs.readFileSync(process.env.MAGNET_ANSWERS, 'utf8');
  assert.equal(
    recordEssay({
      url: 'https://jobs.example.com/b',
      company: 'Example',
      label: 'Why us',
      final: 'Agent typed this into the ATS without the applicant editing it.',
      origin: 'autofill',
    }),
    null
  );
  assert.equal(fs.readFileSync(process.env.MAGNET_ANSWERS, 'utf8'), before);
});
