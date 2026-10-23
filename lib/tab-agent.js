const settings = require('./settings');
const models = require('./models');
const { CHAT_TOOLS } = require('./chat-tools');
const { packForSend, expandFold, formatSeed, nextAgentAction } = require('./context-budget');

function currentAgentModel() {
  return models.toAgentModel(models.selectionFrom(settings.load()));
}

function snapshotKey(payload = {}) {
  const ids = (payload.fields || []).map((f) => f.id).join(',');
  const jd = String((payload.jd && payload.jd.text) || '');
  return `${payload.company || ''}|${payload.title || ''}|${ids}|${jd.length}`;
}

function jobSnapshot(payload = {}) {
  const { buildTurnPrompt } = require('./cascade');
  const packet = buildTurnPrompt({ ...payload, instruction: '', seed: true });
  return `[JobMagnet tab context — remember, do not reply yet]
${packet}`;
}

function planThread(tab, payload, userLine) {
  const windowTokens = models.contextWindow
    ? models.contextWindow(models.findModel(models.catalog(), (settings.load() || {}).modelId))
    : 128000;
  const snapshot = jobSnapshot(payload);
  const live = Array.isArray(tab && tab.chat) ? tab.chat : [];
  const folded = Array.isArray(tab && tab.chatFolded) ? tab.chatFolded : [];
  const packed = packForSend({
    snapshot,
    messages: live,
    userLine,
    windowTokens,
  });
  return {
    snapshot,
    snapKey: snapshotKey(payload),
    ...packed,
    folded: packed.dropped.concat(folded),
    windowTokens,
  };
}

function expandThread(tab, payload, userLine) {
  const windowTokens = 128000;
  return expandFold({
    kept: Array.isArray(tab && tab.chat) ? tab.chat : [],
    folded: Array.isArray(tab && tab.chatFolded) ? tab.chatFolded : [],
    snapshot: jobSnapshot(payload),
    userLine,
    windowTokens,
  });
}

async function mintTabAgent(tab, payload, opts = {}) {
  if (!tab || !tab.meta) return '';
  const client = require('./agent-client');
  const snap = jobSnapshot(payload);
  const key = snapshotKey(payload);
  const force = Boolean(opts.forceCreate || tab.agentNeedsRebuild);
  const out = await client.create(
    {
      key: String(tab.meta.id),
      agentId: force ? null : tab.agentId,
      forceCreate: force,
      snapshot: snap,
      model: opts.model || currentAgentModel(),
      name: 'jobmagnet-chat',
      tools: CHAT_TOOLS.slice(),
      toolSet: 'chat',
    },
    { signal: (tab.fillAbort && tab.fillAbort.signal) || opts.signal }
  );
  tab.agentId = (out && out.agentId) || tab.agentId || '';
  tab.agentSnapshotKey = key;
  tab.agentNeedsRebuild = false;
  return tab.agentId;
}

async function disposeTabAgent(tab) {
  if (!tab || !tab.meta) return;
  try {
    await require('./agent-client').dispose(String(tab.meta.id));
  } catch (_) {}
  tab.agentId = '';
  tab.agentSnapshotKey = '';
}

module.exports = {
  currentAgentModel,
  snapshotKey,
  jobSnapshot,
  planThread,
  expandThread,
  mintTabAgent,
  disposeTabAgent,
  formatSeed,
  nextAgentAction,
};
