const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTiming, reduceCarry, attributeComplete } = require('./timing');

function tab(id, name = id) {
  return { meta: { id, url: `https://jobs.example/${id}`, name, title: `${name} role` } };
}

function tracker() {
  let clock = 0;
  const log = [];
  let sid = 0;
  const t = createTiming({
    now: () => clock,
    file: false,
    append: (row) => log.push(row),
    load: () => log,
    uuid: () => `s${++sid}`,
  });
  return {
    t,
    log,
    tick(ms) {
      clock += ms;
    },
    outcomes() {
      return log.filter((e) => e.type === 'outcome');
    },
  };
}

test('A pass then B complete lumps A into B', () => {
  const { t, tick, outcomes } = tracker();
  t.startSession();
  t.activate(tab('A', 'Acme'), { open: true });
  tick(2000);
  t.pass(tab('A', 'Acme'));
  t.activate(tab('B', 'Beta'), { open: true });
  tick(5000);
  const out = t.complete(tab('B', 'Beta'));
  assert.equal(out.own_ms, 5000);
  assert.equal(out.own_focused_ms, 5000);
  assert.equal(out.inherited_ms, 2000);
  assert.equal(out.inherited_focused_ms, 2000);
  assert.equal(out.attributed_ms, 7000);
  assert.equal(out.attributed_focused_ms, 7000);
  assert.equal(out.inherited_from.length, 1);
  assert.equal(out.inherited_from[0].tab_id, 'A');
  assert.equal(out.inherited_from[0].own_ms, 2000);
  assert.equal(outcomes().filter((e) => e.outcome === 'pass')[0].attributed_ms, 0);
});

test('two passes then complete inherits both', () => {
  const { t, tick } = tracker();
  t.startSession();
  t.activate(tab('A'), { open: true });
  tick(1000);
  t.pass(tab('A'));
  t.activate(tab('B'), { open: true });
  tick(2000);
  t.pass(tab('B'));
  t.activate(tab('C'), { open: true });
  tick(3000);
  const out = t.complete(tab('C'));
  assert.equal(out.own_ms, 3000);
  assert.equal(out.inherited_ms, 3000);
  assert.equal(out.attributed_ms, 6000);
  assert.deepEqual(
    out.inherited_from.map((r) => r.tab_id),
    ['A', 'B']
  );
});

test('switch A to B to A then pass A carries all A segments', () => {
  const { t, tick } = tracker();
  t.startSession();
  t.activate(tab('A'), { open: true });
  tick(2000);
  t.activate(tab('B'), { open: true });
  tick(1000);
  t.activate(tab('A'), { open: true });
  tick(3000);
  t.pass(tab('A'));
  t.activate(tab('B'), { open: true });
  tick(400);
  const out = t.complete(tab('B'));
  assert.equal(out.inherited_ms, 5000);
  assert.equal(out.own_ms, 1400);
  assert.equal(out.attributed_ms, 6400);
  assert.equal(out.inherited_from.length, 1);
  assert.equal(out.inherited_from[0].own_ms, 5000);
});

test('complete with empty carry has inherited_ms 0', () => {
  const { t, tick } = tracker();
  t.startSession();
  t.activate(tab('A'), { open: true });
  tick(1500);
  const out = t.complete(tab('A'));
  assert.equal(out.inherited_ms, 0);
  assert.equal(out.inherited_from.length, 0);
  assert.equal(out.own_ms, 1500);
  assert.equal(out.attributed_ms, 1500);
});

test('blur splits focused vs wall', () => {
  const { t, tick } = tracker();
  t.startSession();
  t.activate(tab('A'), { open: true });
  tick(1000);
  t.blur();
  tick(4000);
  t.focus();
  tick(1000);
  const out = t.complete(tab('A'));
  assert.equal(out.own_ms, 6000);
  assert.equal(out.own_focused_ms, 2000);
  assert.equal(out.attributed_ms, 2000);
  assert.equal(out.attributed_focused_ms, 2000);
});

test('reduceCarry after a complete does not reuse those passes', () => {
  const events = [
    { type: 'deactivate', tab_id: 'A', dwell_ms: 10, focused_ms: 10 },
    { type: 'outcome', outcome: 'pass', tab_id: 'A', own_ms: 10, own_focused_ms: 10 },
    { type: 'deactivate', tab_id: 'B', dwell_ms: 20, focused_ms: 20 },
    {
      type: 'outcome',
      outcome: 'complete',
      tab_id: 'B',
      own_ms: 20,
      inherited_ms: 10,
      attributed_ms: 30,
    },
    { type: 'deactivate', tab_id: 'C', dwell_ms: 5, focused_ms: 5 },
    { type: 'outcome', outcome: 'pass', tab_id: 'C', own_ms: 5, own_focused_ms: 5 },
  ];
  const carry = reduceCarry(events);
  assert.equal(carry.length, 1);
  assert.equal(carry[0].tab_id, 'C');
  assert.equal(carry[0].own_ms, 5);
});

test('boot replay restores unconsumed pass into the next complete', () => {
  const log = [];
  let clock = 0;
  let sid = 0;
  const opts = {
    now: () => clock,
    file: false,
    append: (row) => log.push(row),
    load: () => log,
    uuid: () => `s${++sid}`,
  };
  const t1 = createTiming(opts);
  t1.startSession();
  t1.activate(tab('A'), { open: true });
  clock += 1000;
  t1.pass(tab('A'));
  t1.endSession();
  clock += 999999;
  const t2 = createTiming(opts);
  t2.startSession();
  t2.activate(tab('B'), { open: true });
  clock += 500;
  const out = t2.complete(tab('B'));
  assert.equal(out.inherited_ms, 1000);
  assert.equal(out.own_ms, 500);
  assert.equal(out.attributed_ms, 1500);
});

test('dangling activate is orphaned with zero dwell on next session', () => {
  const log = [];
  let clock = 0;
  let sid = 0;
  const opts = {
    now: () => clock,
    file: false,
    append: (row) => log.push(row),
    load: () => log,
    uuid: () => `s${++sid}`,
  };
  const t1 = createTiming(opts);
  t1.startSession();
  t1.activate(tab('A'), { open: true });
  clock += 5000;
  const t2 = createTiming(opts);
  t2.startSession();
  const orphan = log.find((e) => e.reason === 'orphan');
  assert.ok(orphan);
  assert.equal(orphan.dwell_ms, 0);
  t2.activate(tab('B'), { open: true });
  clock += 100;
  const out = t2.complete(tab('B'));
  assert.equal(out.inherited_ms, 0);
  assert.equal(out.own_ms, 100);
});

test('closed tab does not start an apply dwell', () => {
  const { t, tick, log } = tracker();
  t.startSession();
  t.activate(tab('A'), { open: true });
  tick(1000);
  t.activate(tab('done'), { open: false });
  tick(8000);
  t.activate(tab('B'), { open: true });
  tick(200);
  const out = t.complete(tab('B'));
  assert.equal(out.own_ms, 200);
  assert.equal(out.inherited_ms, 0);
  assert.ok(!log.some((e) => e.type === 'activate' && e.tab_id === 'done'));
});

test('quit mid-apply restores own dwell on the next complete of that tab', () => {
  const log = [];
  let clock = 0;
  let sid = 0;
  const opts = {
    now: () => clock,
    file: false,
    append: (row) => log.push(row),
    load: () => log,
    uuid: () => `s${++sid}`,
  };
  const t1 = createTiming(opts);
  t1.startSession();
  t1.activate(tab('A'), { open: true });
  clock += 4000;
  t1.endSession();
  const t2 = createTiming(opts);
  t2.startSession();
  t2.activate(tab('A'), { open: true });
  clock += 1000;
  const out = t2.complete(tab('A'));
  assert.equal(out.own_ms, 5000);
  assert.equal(out.inherited_ms, 0);
  assert.equal(out.attributed_ms, 5000);
});

test('attributeComplete sums focused as the default attributed figure', () => {
  const out = attributeComplete({
    own: { own_ms: 100, own_focused_ms: 40 },
    carry: [{ tab_id: 'A', own_ms: 50, own_focused_ms: 10 }],
  });
  assert.equal(out.inherited_ms, 50);
  assert.equal(out.inherited_focused_ms, 10);
  assert.equal(out.attributed_ms, 50);
  assert.equal(out.attributed_focused_ms, 50);
});
