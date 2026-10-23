/**
 * Highlight JS eval-script source for the Review pane.
 * UMD: Node `require` and chrome `<script>`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JsHighlight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEYWORDS = new Set([
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'let',
    'new',
    'of',
    'return',
    'static',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'true',
    'false',
    'null',
    'undefined',
  ]);

  const BUILTINS = new Set([
    'document',
    'window',
    'console',
    'Math',
    'JSON',
    'Object',
    'Array',
    'String',
    'Number',
    'Boolean',
    'Promise',
    'Error',
    'Date',
    'RegExp',
    'Map',
    'Set',
    'el',
    'fieldId',
  ]);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function span(cls, text) {
    return '<span class="tok-' + cls + '">' + escapeHtml(text) + '</span>';
  }

  function isIdentStart(c) {
    return /[A-Za-z_$]/.test(c);
  }

  function isIdent(c) {
    return /[\w$]/.test(c);
  }

  function isDigit(c) {
    return c >= '0' && c <= '9';
  }

  function allowsRegex(prev) {
    return (
      prev === '' ||
      prev === 'keyword' ||
      prev === '(' ||
      prev === '[' ||
      prev === '{' ||
      prev === '=' ||
      prev === ',' ||
      prev === ';' ||
      prev === ':' ||
      prev === '!' ||
      prev === '&' ||
      prev === '|' ||
      prev === '?' ||
      prev === '+' ||
      prev === '-' ||
      prev === '~' ||
      prev === '*' ||
      prev === '%' ||
      prev === '^' ||
      prev === '<' ||
      prev === '>'
    );
  }

  function readString(s, start, quote) {
    let i = start + 1;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) return i + 1;
      if (c === '\n' && quote !== '`') return i;
      i += 1;
    }
    return i;
  }

  function skipNested(s, start, highlightInner) {
    let i = start;
    let depth = 1;
    const from = start;
    while (i < s.length && depth) {
      const c = s[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === "'" || c === '"') {
        i = readString(s, i, c);
        continue;
      }
      if (c === '`') {
        const skipped = skipTemplate(s, i);
        i = skipped;
        continue;
      }
      if (c === '/' && s[i + 1] === '/') {
        while (i < s.length && s[i] !== '\n') i += 1;
        continue;
      }
      if (c === '/' && s[i + 1] === '*') {
        i += 2;
        while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1;
        i += 2;
        continue;
      }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (!depth) break;
      }
      i += 1;
    }
    const inner = s.slice(from, i);
    return { html: highlightInner(inner), next: i };
  }

  function skipTemplate(s, start) {
    let i = start + 1;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') return i + 1;
      if (c === '$' && s[i + 1] === '{') {
        const nested = skipNested(s, i + 2, function (inner) {
          return inner;
        });
        i = nested.next;
        if (s[i] === '}') i += 1;
        continue;
      }
      i += 1;
    }
    return i;
  }

  function readRegex(s, start) {
    let i = start + 1;
    let inClass = false;
    while (i < s.length) {
      const c = s[i];
      if (c === '\n') return -1;
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']' && inClass) inClass = false;
      else if (c === '/' && !inClass) {
        i += 1;
        while (i < s.length && /[gimsuyv]/.test(s[i])) i += 1;
        return i;
      }
      i += 1;
    }
    return -1;
  }

  function toHtml(source) {
    const s = String(source || '');
    let i = 0;
    let out = '';
    let prev = '';

    while (i < s.length) {
      const c = s[i];

      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        let j = i + 1;
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j += 1;
        out += escapeHtml(s.slice(i, j));
        i = j;
        continue;
      }

      if (c === '/' && s[i + 1] === '/') {
        let j = i + 2;
        while (j < s.length && s[j] !== '\n') j += 1;
        out += span('comment', s.slice(i, j));
        i = j;
        prev = '';
        continue;
      }

      if (c === '/' && s[i + 1] === '*') {
        let j = i + 2;
        while (j < s.length && !(s[j] === '*' && s[j + 1] === '/')) j += 1;
        if (j < s.length) j += 2;
        out += span('comment', s.slice(i, j));
        i = j;
        prev = '';
        continue;
      }

      if (c === '/' && allowsRegex(prev)) {
        const end = readRegex(s, i);
        if (end > i) {
          out += span('regexp', s.slice(i, end));
          i = end;
          prev = 'id';
          continue;
        }
      }

      if (c === "'" || c === '"') {
        const end = readString(s, i, c);
        out += span('string', s.slice(i, end));
        i = end;
        prev = 'id';
        continue;
      }

      if (c === '`') {
        let j = i + 1;
        let buf = '`';
        while (j < s.length) {
          const ch = s[j];
          if (ch === '\\') {
            buf += s.slice(j, j + 2);
            j += 2;
            continue;
          }
          if (ch === '`') {
            buf += '`';
            j += 1;
            out += span('string', buf);
            buf = '';
            break;
          }
          if (ch === '$' && s[j + 1] === '{') {
            if (buf) out += span('string', buf);
            buf = '';
            out += span('punct', '${');
            j += 2;
            const nested = skipNested(s, j, toHtml);
            out += nested.html;
            j = nested.next;
            if (s[j] === '}') {
              out += span('punct', '}');
              j += 1;
            }
            continue;
          }
          buf += ch;
          j += 1;
        }
        if (j >= s.length && buf) out += span('string', buf);
        i = j;
        prev = 'id';
        continue;
      }

      if (isDigit(c) || (c === '.' && isDigit(s[i + 1]))) {
        let j = i;
        if (s[i] === '0' && /[xXbBoO]/.test(s[i + 1] || '')) j += 2;
        while (j < s.length && /[\d._a-fA-Fn]/.test(s[j])) j += 1;
        out += span('number', s.slice(i, j));
        i = j;
        prev = 'id';
        continue;
      }

      if (isIdentStart(c)) {
        let j = i + 1;
        while (j < s.length && isIdent(s[j])) j += 1;
        const word = s.slice(i, j);
        let k = j;
        while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k += 1;
        if (KEYWORDS.has(word)) {
          out += span('keyword', word);
          prev = 'keyword';
        } else if (BUILTINS.has(word)) {
          out += span('builtin', word);
          prev = 'id';
        } else if (s[k] === '(') {
          out += span('fn', word);
          prev = 'id';
        } else {
          out += escapeHtml(word);
          prev = 'id';
        }
        i = j;
        continue;
      }

      out += span('punct', c);
      prev = c;
      i += 1;
    }

    return out;
  }

  return { toHtml, escapeHtml };
});
