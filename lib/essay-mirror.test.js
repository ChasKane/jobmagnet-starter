const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SAVE_PAUSE_MS, createMirrorSaver, attachMirrorScript } = require('./essay-mirror');

function fakeClock() {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => now,
    schedule(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers.entries()]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

test('SAVE_PAUSE_MS is two seconds', () => {
  assert.equal(SAVE_PAUSE_MS, 2000);
});

test('input does not save until the pause elapses', async () => {
  const clock = fakeClock();
  const saved = [];
  const saver = createMirrorSaver({
    delay: SAVE_PAUSE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    save: (value) => saved.push(value),
  });
  saver.onInput('hello');
  assert.deepEqual(saved, []);
  clock.advance(1999);
  assert.deepEqual(saved, []);
  clock.advance(1);
  assert.deepEqual(saved, ['hello']);
});

test('another keystroke resets the pause', async () => {
  const clock = fakeClock();
  const saved = [];
  const saver = createMirrorSaver({
    delay: SAVE_PAUSE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    save: (value) => saved.push(value),
  });
  saver.onInput('hel');
  clock.advance(1500);
  saver.onInput('hello');
  clock.advance(1500);
  assert.deepEqual(saved, []);
  clock.advance(500);
  assert.deepEqual(saved, ['hello']);
});

test('blur saves immediately and cancels the pause', async () => {
  const clock = fakeClock();
  const saved = [];
  const saver = createMirrorSaver({
    delay: SAVE_PAUSE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    save: (value) => saved.push(value),
  });
  saver.onInput('hel');
  await saver.onBlur('hello');
  clock.advance(2000);
  assert.deepEqual(saved, ['hello']);
});

test('flush writes a pending pause; primed value is a no-op', async () => {
  const clock = fakeClock();
  const saved = [];
  const saver = createMirrorSaver({
    delay: SAVE_PAUSE_MS,
    schedule: clock.schedule,
    cancel: clock.cancel,
    save: (value) => saved.push(value),
  });
  saver.prime('draft');
  const idle = await saver.flush();
  assert.equal(idle.skipped, true);
  assert.deepEqual(saved, []);
  saver.onInput('edited');
  await saver.flush();
  assert.deepEqual(saved, ['edited']);
});

test('unchanged blur does not write again', async () => {
  const saved = [];
  const saver = createMirrorSaver({
    delay: 10,
    schedule: (fn) => fn(),
    cancel() {},
    save: (value) => saved.push(value),
  });
  await saver.onBlur('same');
  await saver.onBlur('same');
  assert.deepEqual(saved, ['same']);
});

test('attach script saves on blur and pause, not raw input', () => {
  const src = attachMirrorScript('messay1');
  assert.match(src, /onBlur/);
  assert.match(src, /onInput/);
  assert.match(src, /2000/);
  assert.doesNotMatch(src, /addEventListener\('input', send\)/);
  assert.match(src, /magnet-saved-chip/);
  assert.match(src, /pagehide/);
});
