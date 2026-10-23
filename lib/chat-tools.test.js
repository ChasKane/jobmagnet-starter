const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAsks, formatAskAnswers, sharedCustomTools } = require('./chat-tools');

describe('normalizeAsks', () => {
  it('accepts questions wrapper and string options', () => {
    const asks = normalizeAsks({
      questions: [{ id: 'remote', prompt: 'Remote only?', options: ['Yes', { label: 'No' }] }],
    });
    assert.equal(asks.length, 1);
    assert.equal(asks[0].id, 'remote');
    assert.equal(asks[0].options.length, 2);
    assert.equal(asks[0].options[0].label, 'Yes');
  });
});

describe('formatAskAnswers', () => {
  it('joins selected answers', () => {
    const text = formatAskAnswers([{ id: 'a', prompt: 'Which board?' }], { a: ['Ashby', 'Lever'] });
    assert.match(text, /Which board/);
    assert.match(text, /Ashby, Lever/);
  });
});

describe('sharedCustomTools', () => {
  it('does not define Cursor webSearch or webFetch', () => {
    const tools = sharedCustomTools({ traces: [], asks: [] });
    assert.equal(tools.webSearch, undefined);
    assert.equal(tools.webFetch, undefined);
    assert.equal(typeof tools.read.execute, 'function');
    assert.equal(typeof tools.askQuestion.execute, 'function');
  });
});
