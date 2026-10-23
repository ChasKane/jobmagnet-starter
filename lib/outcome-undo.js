const HOLD_MS = 5500;

function snapshotRecord(rec) {
  return {
    status: (rec && rec.status) || 'open',
    submitted_at: (rec && rec.submitted_at) || null,
    rejected_at: (rec && rec.rejected_at) || null,
  };
}

function revertRecord(rec, eventType, snap) {
  const events = Array.isArray(rec && rec.events) ? rec.events.map((row) => ({ ...row })) : [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (!events[i].deleted && events[i].type === eventType) {
      events[i].deleted = true;
      break;
    }
  }
  const prev = snap || {};
  return {
    ...(rec || {}),
    events,
    status: prev.status || 'open',
    submitted_at: prev.submitted_at == null ? null : prev.submitted_at,
    rejected_at: prev.rejected_at == null ? null : prev.rejected_at,
  };
}

function countKind(kind) {
  if (kind === 'complete') return 'submitted';
  if (kind === 'pass') return 'passed';
  return 'rejected';
}

function eventTypeOf(kind) {
  if (kind === 'complete') return 'submitted';
  if (kind === 'pass') return 'passed';
  return 'rejected';
}

function toastPayload({ kind, name, detail, holdMs = HOLD_MS }) {
  const verb = kind === 'complete' ? 'Completed' : kind === 'pass' ? 'Passed' : 'Rejected';
  const who = String(name || '').trim();
  const message = [who ? `${verb} ${who}` : verb, detail].filter(Boolean).join(' · ');
  return {
    message,
    undo: true,
    kind,
    holdMs,
  };
}

module.exports = {
  HOLD_MS,
  snapshotRecord,
  revertRecord,
  countKind,
  eventTypeOf,
  toastPayload,
};
