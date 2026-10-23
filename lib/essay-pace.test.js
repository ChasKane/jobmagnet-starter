const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  getEssayWpm,
  msPerChar,
  intraGap,
  nextBurstLength,
  restAfterBurst,
  eventsForChar,
  typeTextEvents,
  prepareEssayTypeScript,
} = require('./essay-pace');

test('words per minute use a five-character word', () => {
  assert.equal(getEssayWpm(), 60);
  assert.equal(msPerChar(30), 400);
  assert.equal(msPerChar(100), 120);
  assert.equal(msPerChar(20), 600);
  assert.equal(msPerChar(400), 30);
});

test('default typing speed is 60 wpm', async () => {
  const delays = [];
  await typeTextEvents(
    { sendInputEvent: () => {} },
    'ab',
    { random: () => 1, burstLength: () => 4, sleep: async (ms) => delays.push(ms) }
  );
  assert.deepEqual(delays, [intraGap(msPerChar(60))]);
  assert.equal(delays[0], 70);
});

test('keystrokes leave in bursts that still average 60 wpm', async () => {
  const base = msPerChar(60);
  const lengths = [3, 2, 4];
  let n = 0;
  const delays = [];
  await typeTextEvents(
    { sendInputEvent: () => {} },
    'x'.repeat(10),
    {
      random: () => 1,
      burstLength: () => lengths[Math.min(n++, lengths.length - 1)],
      sleep: async (ms) => delays.push(ms),
    }
  );
  assert.deepEqual(delays, [70, 70, 460, 70, 330, 70, 70, 70, 590]);
  const avg = delays.reduce((sum, ms) => sum + ms, 0) / delays.length;
  assert.ok(Math.abs(avg - base) <= 1);
  assert.ok(Math.min(...delays) < base);
  assert.ok(Math.max(...delays) > base);
});

test('burst length varies and sometimes runs for several words', () => {
  const rolls = [0.1, 0, 0.5, 0, 0.95, 0.99];
  let i = 0;
  const random = () => rolls[i++];
  const short = nextBurstLength(random);
  const word = nextBurstLength(random);
  const phrase = nextBurstLength(random);
  assert.ok(short >= 1 && short <= 4);
  assert.ok(word >= 5 && word <= 12);
  assert.ok(phrase >= 13 && phrase <= 32);
  assert.ok(phrase >= 5 * 2);
  assert.equal(new Set([short, word, phrase]).size, 3);
});

test('a multi-word burst stays fast and then rests', async () => {
  const lengths = [2, 20];
  let n = 0;
  const delays = [];
  await typeTextEvents(
    { sendInputEvent: () => {} },
    'x'.repeat(23),
    {
      random: () => 1,
      burstLength: () => lengths[Math.min(n++, lengths.length - 1)],
      sleep: async (ms) => delays.push(ms),
    }
  );
  const fast = delays.slice(2, 21);
  assert.equal(fast.length, 19);
  assert.ok(fast.every((ms) => ms === 70));
  assert.equal(delays[21], restAfterBurst(60, 20));
  assert.equal(delays[21], restAfterBurst(60, 4));
  assert.ok(delays[21] > 70);
  assert.ok(delays[21] < 800);
});

test('each essay character is one sendInputEvent char', () => {
  assert.deepEqual(eventsForChar('a'), [{ type: 'char', keyCode: 'a' }]);
  assert.deepEqual(eventsForChar(' '), [{ type: 'char', keyCode: ' ' }]);
  assert.deepEqual(eventsForChar('\n'), [
    { type: 'keyDown', keyCode: 'Enter' },
    { type: 'char', keyCode: '\r' },
    { type: 'keyUp', keyCode: 'Enter' },
  ]);
});

test('typer sends trusted key events at the current wpm', async () => {
  const sent = [];
  const delays = [];
  let wpm = 100;
  await typeTextEvents(
    { sendInputEvent: (ev) => sent.push(ev) },
    'Hi\n',
    {
      getWpm: () => wpm,
      random: () => 1,
      burstLength: () => 8,
      sleep: async (ms) => {
        delays.push(ms);
        wpm = 400;
      },
    }
  );
  assert.deepEqual(sent, [
    { type: 'char', keyCode: 'H' },
    { type: 'char', keyCode: 'i' },
    { type: 'keyDown', keyCode: 'Enter' },
    { type: 'char', keyCode: '\r' },
    { type: 'keyUp', keyCode: 'Enter' },
  ]);
  assert.deepEqual(delays, [intraGap(msPerChar(100)), intraGap(msPerChar(400))]);
});

test('paragraph breaks are typed as newline characters', async () => {
  const sent = [];
  await typeTextEvents(
    { sendInputEvent: (ev) => sent.push(ev.keyCode) },
    'A\n\nB',
    { random: () => 1, burstLength: () => 8, sleep: async () => {} }
  );
  assert.deepEqual(sent, ['A', 'Enter', '\r', 'Enter', 'Enter', '\r', 'Enter', 'B']);
});

test('typer stops when the fill is cancelled', async () => {
  const sent = [];
  const signal = { aborted: false };
  await assert.rejects(
    () =>
      typeTextEvents(
        {
          sendInputEvent: (ev) => {
            sent.push(ev);
            signal.aborted = true;
          },
        },
        'Hello',
        { getWpm: () => 100, sleep: async () => {}, signal, random: () => 1 }
      ),
    (err) => err && err.cancelled
  );
  assert.deepEqual(sent, [{ type: 'char', keyCode: 'H' }]);
});

test('typer mistypes a neighbor key and backspaces it', async () => {
  const rolls = [0, 0.9, 0];
  let n = 0;
  const sent = [];
  await typeTextEvents(
    { sendInputEvent: (ev) => sent.push(ev.type + ':' + ev.keyCode) },
    'A ',
    {
      getWpm: () => 100,
      sleep: async () => {},
      random: () => rolls[n++],
    }
  );
  assert.deepEqual(sent, [
    'char:Q',
    'keyDown:Backspace',
    'keyUp:Backspace',
    'char:A',
    'char: ',
  ]);
});

test('a fumble can be two mistypes then two backspaces', async () => {
  const rolls = [0, 0.1, 0, 0];
  let n = 0;
  const sent = [];
  await typeTextEvents(
    { sendInputEvent: (ev) => sent.push(ev.keyCode) },
    'a',
    {
      getWpm: () => 100,
      sleep: async () => {},
      random: () => rolls[n++],
    }
  );
  assert.deepEqual(sent, ['q', 'q', 'Backspace', 'Backspace', 'Backspace', 'Backspace', 'a']);
});

function fakeTextarea() {
  function HTMLTextAreaElement() {}
  Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
    configurable: true,
    get() {
      return this._v || '';
    },
    set(v) {
      this._v = String(v);
    },
  });
  const el = Object.create(HTMLTextAreaElement.prototype);
  el._v = 'Let me think on this…';
  el.tagName = 'TEXTAREA';
  el.type = 'textarea';
  el.isContentEditable = false;
  el._events = [];
  el._sel = null;
  el.focused = false;
  el.getAttribute = () => null;
  el.setAttribute = () => {};
  el.focus = () => {
    el.focused = true;
  };
  el.setSelectionRange = (a, b) => {
    el._sel = [a, b];
  };
  el.scrollIntoView = () => {};
  el.dispatchEvent = (ev) => {
    el._events.push(ev);
  };
  return { el };
}

function runPrepare(script, el) {
  const sandbox = {
    document: {
      querySelector(sel) {
        return sel.includes('pitch') ? el : null;
      },
    },
    window: {
      __magnetAutoScroll: false,
      __magnetHarvestPause: false,
      CSS: { escape: (s) => s },
    },
    String,
  };
  return { result: vm.runInNewContext(script, sandbox), window: sandbox.window };
}

test('prepare selects the essay field and does not write it', () => {
  const fake = fakeTextarea();
  const { result, window: page } = runPrepare(prepareEssayTypeScript('pitch'), fake.el);
  assert.equal(result.ok, true);
  assert.equal(fake.el.focused, true);
  assert.deepEqual(fake.el._sel, [0, 'Let me think on this…'.length]);
  assert.equal(fake.el.value, 'Let me think on this…');
  assert.equal(fake.el._events.length, 0);
  assert.equal(page.__magnetHarvestPause, true);
});

test('prepare leaves selects alone', () => {
  const fake = fakeTextarea();
  fake.el.tagName = 'SELECT';
  const { result, window: page } = runPrepare(prepareEssayTypeScript('pitch'), fake.el);
  assert.equal(result.reason, 'not-text');
  assert.equal(page.__magnetHarvestPause, false);
});
