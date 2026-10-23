const DEFAULT_WINDOW = 128000;
const SEND_FRACTION = 0.5;
const UI_MAX = 200;

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function messageTokens(m) {
  if (!m) return 0;
  const drafts = Array.isArray(m.drafts) ? m.drafts.map((d) => (d && d.text) || '').join('\n') : '';
  return estimateTokens(`${m.role || ''}\n${m.text || ''}\n${drafts}`);
}

function threadTokens(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((n, m) => n + messageTokens(m), 0);
}

function modelWindow(model, fallback = DEFAULT_WINDOW) {
  const raw =
    (model && (model.contextWindow || model.context_window || model.window)) ||
    fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 256 ? n : fallback;
}

function packForSend({ snapshot = '', messages = [], userLine = '', windowTokens, usageTokens } = {}) {
  const window = modelWindow({ contextWindow: windowTokens }, DEFAULT_WINDOW);
  const budget = Math.floor(window * SEND_FRACTION);
  const extra = Number(usageTokens) || 0;
  const snapshotTok = estimateTokens(snapshot);
  const userTok = estimateTokens(userLine);
  const kept = Array.isArray(messages) ? messages.slice() : [];
  const dropped = [];
  const overhead = snapshotTok + userTok + extra;
  while (kept.length && overhead + threadTokens(kept) > budget) {
    dropped.push(kept.shift());
  }
  return {
    kept,
    dropped,
    yeeted: dropped.length > 0,
    tokens: overhead + threadTokens(kept),
    budget,
    window,
  };
}

/** Restore newest-dropped first until the full window is used. */
function expandFold({ kept = [], folded = [], snapshot = '', userLine = '', windowTokens } = {}) {
  const window = modelWindow({ contextWindow: windowTokens }, DEFAULT_WINDOW);
  const snapshotTok = estimateTokens(snapshot);
  const userTok = estimateTokens(userLine);
  const nextKept = kept.slice();
  const nextFolded = folded.slice();
  while (nextFolded.length) {
    const candidate = nextFolded[nextFolded.length - 1];
    const trial = [...nextKept, candidate];
    if (snapshotTok + userTok + threadTokens(trial) > window) break;
    nextKept.unshift(nextFolded.pop());
  }
  if (snapshotTok + userTok + threadTokens(nextKept) > window) {
    const packed = packForSend({
      snapshot,
      messages: nextKept,
      userLine,
      windowTokens: window,
    });
    return {
      kept: packed.kept,
      folded: packed.dropped.concat(nextFolded),
      yeeted: packed.yeeted,
      expanded: packed.kept.length > kept.length,
      window,
    };
  }
  return {
    kept: nextKept,
    folded: nextFolded,
    yeeted: nextFolded.length > 0,
    expanded: nextKept.length > kept.length,
    window,
  };
}

function formatSeed(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return '';
  return `Prior conversation on this job tab (kept suffix):\n${list
    .map((m) => `${m.role === 'you' ? 'Applicant' : 'Magnet'}: ${String(m.text || '').slice(0, 1200)}`)
    .join('\n')}`;
}

function nextAgentAction({ agentId, modelChanged, yeet, expand } = {}) {
  if (yeet || expand) return { mint: true, keepId: false, sendModel: Boolean(modelChanged) };
  if (modelChanged) return { mint: false, keepId: Boolean(agentId), sendModel: true };
  return { mint: !agentId, keepId: Boolean(agentId), sendModel: false };
}

module.exports = {
  DEFAULT_WINDOW,
  SEND_FRACTION,
  UI_MAX,
  estimateTokens,
  messageTokens,
  threadTokens,
  modelWindow,
  packForSend,
  expandFold,
  formatSeed,
  nextAgentAction,
};
