const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const TIMING_LOG = path.join(__dirname, '..', 'knowledge', 'archive', 'timing.jsonl');

function readJsonl(file) {
  try {
    if (!file || !fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeJsonl(file, row) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  } catch (_) {}
}

function tabInfo(tab) {
  const meta = (tab && tab.meta) || tab || {};
  return {
    tab_id: meta.id || '',
    url: meta.url || '',
    company: meta.name || meta.company || '',
    title: meta.title || '',
  };
}

function emptyOwn(info) {
  return {
    tab_id: info.tab_id,
    url: info.url,
    company: info.company,
    title: info.title,
    own_ms: 0,
    own_focused_ms: 0,
  };
}

function addOwn(map, info, wallMs, focusedMs) {
  const prev = map.get(info.tab_id) || emptyOwn(info);
  map.set(info.tab_id, {
    tab_id: info.tab_id,
    url: info.url || prev.url,
    company: info.company || prev.company,
    title: info.title || prev.title,
    own_ms: prev.own_ms + Math.max(0, wallMs || 0),
    own_focused_ms: prev.own_focused_ms + Math.max(0, focusedMs || 0),
  });
}

function carryEntry(row) {
  return {
    tab_id: row.tab_id,
    url: row.url || '',
    company: row.company || '',
    title: row.title || '',
    own_ms: Number(row.own_ms || 0),
    own_focused_ms: Number(row.own_focused_ms || 0),
  };
}

function attributeComplete({ own, carry }) {
  const inherited_from = (carry || []).map(carryEntry);
  const inherited_ms = inherited_from.reduce((n, r) => n + r.own_ms, 0);
  const inherited_focused_ms = inherited_from.reduce((n, r) => n + r.own_focused_ms, 0);
  const own_ms = Number((own && own.own_ms) || 0);
  const own_focused_ms = Number((own && own.own_focused_ms) || 0);
  const attributed_focused_ms = own_focused_ms + inherited_focused_ms;
  return {
    own_ms,
    own_focused_ms,
    inherited_ms,
    inherited_focused_ms,
    attributed_ms: attributed_focused_ms,
    attributed_focused_ms,
    inherited_from,
  };
}

function findDanglingActivate(events) {
  let open = null;
  for (const e of events || []) {
    if (e.type === 'activate') open = e;
    if (e.type === 'deactivate' || e.type === 'session_end') open = null;
    if (e.type === 'outcome' && open && e.tab_id === open.tab_id) open = null;
  }
  return open;
}

function reduceState(events) {
  const own = new Map();
  const carry = [];
  for (const e of events || []) {
    if (e.type === 'deactivate') {
      addOwn(own, e, e.dwell_ms, e.focused_ms);
    } else if (e.type === 'outcome' && e.outcome === 'pass') {
      const fromOwn = own.get(e.tab_id);
      carry.push(carryEntry(fromOwn || e));
      own.delete(e.tab_id);
    } else if (e.type === 'outcome' && e.outcome === 'complete') {
      own.delete(e.tab_id);
      carry.length = 0;
    }
  }
  return { own, carry };
}

function reduceCarry(events) {
  return reduceState(events).carry;
}

function createTiming(opts = {}) {
  const now = opts.now || (() => Date.now());
  const newId = opts.uuid || (() => randomUUID());
  const file = opts.file === undefined ? TIMING_LOG : opts.file;
  const focusedInit = opts.focused !== false;

  let sessionId = null;
  let ended = false;
  let focused = focusedInit;
  let current = null;
  let own = new Map();
  let carry = [];

  function iso() {
    return new Date(now()).toISOString();
  }

  function load() {
    if (opts.load) return opts.load();
    if (file) return readJsonl(file);
    return [];
  }

  function append(row) {
    const { session_id: rowSid, ...rest } = row;
    const event = { ts: iso(), session_id: rowSid || sessionId, ...rest };
    if (opts.append) {
      try {
        opts.append(event);
      } catch (_) {}
    } else {
      let remote = false;
      try {
        remote = require('./store/remote-log').insert('timing_events', {
          ts: event.ts,
          kind: event.type || event.kind || 'event',
          tab_id: event.tab_id || null,
          url: event.url || null,
          company: event.company || null,
          title: event.title || null,
          payload: event,
        });
      } catch (err) {
        console.warn('[magnet] timing log:', (err && err.message) || err);
      }
      if (!remote && file) writeJsonl(file, event);
    }
    return event;
  }

  function closeCurrent(reason) {
    if (!current) return null;
    const t = now();
    const wall_ms = Math.max(0, t - current.startedAt);
    let focused_ms = current.focusedAcc;
    if (current.focusedStarted != null) focused_ms += Math.max(0, t - current.focusedStarted);
    addOwn(own, current.info, wall_ms, focused_ms);
    const event = append({
      type: 'deactivate',
      ...current.info,
      reason,
      dwell_ms: wall_ms,
      focused_ms,
    });
    current = null;
    return event;
  }

  function takeOwn(info) {
    return own.get(info.tab_id) || emptyOwn(info);
  }

  function startSession() {
    if (sessionId && !ended) endSession();
    const prev = load();
    const dangling = findDanglingActivate(prev);
    if (dangling) {
      sessionId = dangling.session_id || 'orphan';
      ended = false;
      append({
        type: 'deactivate',
        tab_id: dangling.tab_id,
        url: dangling.url || '',
        company: dangling.company || '',
        title: dangling.title || '',
        reason: 'orphan',
        dwell_ms: 0,
        focused_ms: 0,
        session_id: dangling.session_id,
      });
    }
    const reduced = reduceState(load());
    own = reduced.own;
    carry = reduced.carry;
    sessionId = newId();
    ended = false;
    focused = focusedInit;
    current = null;
    append({ type: 'session_start' });
    return sessionId;
  }

  function activate(tab, flags = {}) {
    if (!sessionId || ended) return null;
    const info = tabInfo(tab);
    const open = flags.open !== false;
    if (current && current.info.tab_id === info.tab_id) {
      if (!open) closeCurrent('switch');
      return current;
    }
    closeCurrent('switch');
    if (!open || !info.tab_id) return null;
    const t = now();
    current = {
      info,
      startedAt: t,
      focusedAcc: 0,
      focusedStarted: focused ? t : null,
    };
    return append({ type: 'activate', ...info });
  }

  function focus() {
    if (!sessionId || ended) return null;
    if (focused) return null;
    focused = true;
    if (current && current.focusedStarted == null) current.focusedStarted = now();
    return append({ type: 'focus' });
  }

  function blur() {
    if (!sessionId || ended) return null;
    if (!focused) return null;
    focused = false;
    if (current && current.focusedStarted != null) {
      current.focusedAcc += Math.max(0, now() - current.focusedStarted);
      current.focusedStarted = null;
    }
    return append({ type: 'blur' });
  }

  function pass(tab) {
    if (!sessionId || ended) return null;
    const info = tabInfo(tab);
    if (current && current.info.tab_id === info.tab_id) closeCurrent('pass');
    const row = takeOwn(info);
    carry.push(carryEntry(row));
    own.delete(info.tab_id);
    return append({
      type: 'outcome',
      outcome: 'pass',
      ...info,
      own_ms: row.own_ms,
      own_focused_ms: row.own_focused_ms,
      inherited_ms: 0,
      inherited_focused_ms: 0,
      attributed_ms: 0,
      attributed_focused_ms: 0,
      inherited_from: [],
    });
  }

  function complete(tab) {
    if (!sessionId || ended) return null;
    const info = tabInfo(tab);
    if (current && current.info.tab_id === info.tab_id) closeCurrent('complete');
    const row = takeOwn(info);
    const attributed = attributeComplete({ own: row, carry });
    own.delete(info.tab_id);
    carry = [];
    return append({
      type: 'outcome',
      outcome: 'complete',
      ...info,
      ...attributed,
    });
  }

  function closeActive(reason) {
    if (!sessionId || ended) return null;
    return closeCurrent(reason || 'removed');
  }

  function endSession() {
    if (!sessionId || ended) return null;
    closeCurrent('quit');
    const event = append({ type: 'session_end' });
    ended = true;
    return event;
  }

  return {
    startSession,
    activate,
    complete,
    pass,
    focus,
    blur,
    closeActive,
    endSession,
  };
}

module.exports = {
  TIMING_LOG,
  createTiming,
  reduceCarry,
  reduceState,
  attributeComplete,
  findDanglingActivate,
};
