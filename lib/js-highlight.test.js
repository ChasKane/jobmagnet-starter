const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toHtml, escapeHtml } = require('../chrome/js-highlight');

function textOf(html) {
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

test('round-trips source through highlight spans', () => {
  const src = 'const x = el.querySelector(".ok");\n// hi\nreturn /yes/i.test(x);';
  assert.equal(textOf(toHtml(src)), src);
});

test('escapes HTML in source', () => {
  const src = 'el.innerHTML = "<script>alert(1)</script>";';
  const html = toHtml(src);
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(textOf(html), src);
});

test('marks keywords, strings, builtins, and calls', () => {
  const html = toHtml('const n = el.querySelector("button");');
  assert.ok(html.includes('class="tok-keyword">const<'));
  assert.ok(html.includes('class="tok-builtin">el<'));
  assert.ok(html.includes('class="tok-fn">querySelector<'));
  assert.ok(html.includes('class="tok-string">"button"<'));
});

test('highlights comments and regex, not division', () => {
  const comments = toHtml('/* block */\nfoo // line');
  assert.ok(comments.includes('class="tok-comment">/* block */<'));
  assert.ok(comments.includes('class="tok-comment">// line<'));
  const re = toHtml('return /yes|no/i;');
  assert.ok(re.includes('class="tok-regexp">/yes|no/i<'));
  const div = toHtml('a / b');
  assert.equal(div.includes('tok-regexp'), false);
});

test('highlights template interpolation', () => {
  const src = 'el.click(`${fieldId}`)';
  const html = toHtml(src);
  assert.ok(html.includes('class="tok-builtin">fieldId<'));
  assert.ok(html.includes('class="tok-punct">${<'));
  assert.equal(textOf(html), src);
});

test('escapeHtml is used for raw overlay fallback', () => {
  assert.equal(escapeHtml('<x>&'), '&lt;x&gt;&amp;');
});
