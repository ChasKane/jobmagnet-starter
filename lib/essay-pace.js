/** Essay typing speed. A word is five characters. Essays type at 60 words per minute.
 *  Keystrokes leave in bursts: fast inside a burst, then a short rest.
 *  Burst length varies. Most are a few characters or a word. Some run for
 *  several words. The rest does not grow with that length. */

const ESSAY_WPM = 60;
const CHARS_PER_WORD = 5;
const INTRA_RATIO = 0.35;
const MIN_GAP_MS = 16;
const BURST_SHORT = [1, 4];
const BURST_WORD = [5, 12];
const BURST_PHRASE = [13, 32];

function getEssayWpm() {
  return ESSAY_WPM;
}

function msPerChar(wpm) {
  const n = Number(wpm);
  const speed = Number.isFinite(n) && n > 0 ? n : ESSAY_WPM;
  return Math.round(60000 / (speed * CHARS_PER_WORD));
}

function intraGap(base) {
  return Math.max(MIN_GAP_MS, Math.round(base * INTRA_RATIO));
}

function rollInt(random, lo, hi) {
  const span = hi - lo + 1;
  const r = random();
  if (!(r < 1)) return hi;
  return lo + Math.floor(r * span);
}

function nextBurstLength(random) {
  const roll = (random || Math.random)();
  const pick = random || Math.random;
  if (roll < 0.42) return rollInt(pick, BURST_SHORT[0], BURST_SHORT[1]);
  if (roll < 0.72) return rollInt(pick, BURST_WORD[0], BURST_WORD[1]);
  return rollInt(pick, BURST_PHRASE[0], BURST_PHRASE[1]);
}

function restAfterBurst(wpm, length) {
  const base = msPerChar(wpm);
  const intra = intraGap(base);
  const n = Math.max(1, Math.round(Number(length) || 1));
  const full = Math.max(intra, Math.round(n * base - (n - 1) * intra));
  const cap = Math.max(intra, Math.round(4 * base - 3 * intra));
  return Math.min(full, cap);
}

const NEIGHBORS = {
  q: 'wa', w: 'qeas', e: 'wsdr', r: 'edft', t: 'rfgy', y: 'tghu', u: 'yhji', i: 'ujko', o: 'iklp', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};
const MISTYPE_RATE = 0.01;

function eventsForChar(ch) {
  if (ch === '\n' || ch === '\r') {
    return [
      { type: 'keyDown', keyCode: 'Enter' },
      { type: 'char', keyCode: '\r' },
      { type: 'keyUp', keyCode: 'Enter' },
    ];
  }
  return [{ type: 'char', keyCode: ch }];
}

function backspaceEvents() {
  return [
    { type: 'keyDown', keyCode: 'Backspace' },
    { type: 'keyUp', keyCode: 'Backspace' },
  ];
}

function neighborChar(ch, random) {
  const lower = String(ch || '').toLowerCase();
  const row = NEIGHBORS[lower];
  if (!row) return '';
  const pick = row[Math.floor(random() * row.length)] || row[0];
  if (!pick || pick === lower) return '';
  return ch === lower ? pick : pick.toUpperCase();
}

function mistypeChars(ch, random) {
  if (!/^[a-z]$/i.test(ch)) return [];
  if (random() >= MISTYPE_RATE) return [];
  const count = random() < 0.22 ? 2 : 1;
  const wrong = [];
  for (let i = 0; i < count; i++) {
    const hit = neighborChar(ch, random);
    if (hit) wrong.push(hit);
  }
  return wrong;
}

async function sendInputEvents(wc, events) {
  for (const ev of events) {
    const sent = wc.sendInputEvent(ev);
    if (sent && typeof sent.then === 'function') await sent;
  }
}

function throwIfTypingCancelled(signal) {
  if (signal && signal.aborted) {
    const err = new Error('fill cancelled');
    err.cancelled = true;
    throw err;
  }
}

async function typeTextEvents(wc, text, opts) {
  const getWpm = (opts && opts.getWpm) || getEssayWpm;
  const sleep = (opts && opts.sleep) || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const signal = opts && opts.signal;
  const random = (opts && opts.random) || Math.random;
  const burstLength = (opts && opts.burstLength) || (() => nextBurstLength(Math.random));
  let strokes = 0;
  let left = 0;
  let prevLen = 0;
  const gap = async () => {
    if (strokes === 0) {
      prevLen = Math.max(1, Math.round(Number(burstLength()) || 1));
      left = prevLen - 1;
      strokes += 1;
      return;
    }
    const wpm = getWpm();
    const intra = intraGap(msPerChar(wpm));
    let ms = intra;
    if (left > 0) {
      left -= 1;
    } else {
      ms = restAfterBurst(wpm, prevLen);
      prevLen = Math.max(1, Math.round(Number(burstLength()) || 1));
      left = prevLen - 1;
    }
    await sleep(ms);
    strokes += 1;
  };
  for (const ch of String(text || '')) {
    throwIfTypingCancelled(signal);
    const wrong = mistypeChars(ch, random);
    for (const hit of wrong) {
      throwIfTypingCancelled(signal);
      await gap();
      await sendInputEvents(wc, eventsForChar(hit));
    }
    for (let i = 0; i < wrong.length; i++) {
      throwIfTypingCancelled(signal);
      await gap();
      await sendInputEvents(wc, backspaceEvents());
    }
    throwIfTypingCancelled(signal);
    await gap();
    await sendInputEvents(wc, eventsForChar(ch));
  }
}

function prepareEssayTypeScript(fieldId) {
  const id = JSON.stringify(String(fieldId || ''));
  return `(() => {
    const id = ${id};
    const cssEscape = (value) =>
      window.CSS && window.CSS.escape ? window.CSS.escape(value) : String(value).replace(/"/g, '');
    const el = document.querySelector('[data-magnet-field="' + cssEscape(id) + '"]');
    if (!el) return { ok: false, reason: 'missing' };
    const tag = String(el.tagName || '');
    const type = String(el.type || '').toLowerCase();
    const role = String((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
    const textBox =
      el.isContentEditable ||
      tag === 'TEXTAREA' ||
      (tag === 'INPUT' && !['checkbox', 'radio', 'hidden', 'file', 'submit', 'button', 'date', 'number'].includes(type));
    if (!textBox || tag === 'SELECT' || role === 'combobox' || role === 'listbox') {
      return { ok: false, reason: 'not-text' };
    }
    window.__magnetHarvestPause = true;
    try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (_) {} }
    if (window.__magnetAutoScroll === true) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
    }
    if (el.isContentEditable) {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection && window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (_) {}
    } else {
      try { el.setSelectionRange(0, String(el.value || '').length); } catch (_) {}
    }
    return { ok: true };
  })()`;
}

module.exports = {
  ESSAY_WPM,
  CHARS_PER_WORD,
  getEssayWpm,
  msPerChar,
  intraGap,
  nextBurstLength,
  restAfterBurst,
  eventsForChar,
  typeTextEvents,
  prepareEssayTypeScript,
};
