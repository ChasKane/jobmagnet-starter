function fieldById(tab, id) {
  if (!tab || !id) return null;
  const fields = tab.debugFields || [];
  const direct = fields.find((f) => f && f.id === id);
  if (direct) return direct;
  return fields.find((f) => ((f && f.controls) || []).some((c) => c && c.id === id)) || null;
}

function isChatAsk(ask) {
  if (!ask || ask.answered) return false;
  if (ask.reason === 'no-fact' || ask.reason === 'unlabeled') return false;
  return Boolean(String(ask.question || ask.prompt || '').trim());
}

function teachPendingFrom(tab) {
  const ask = ((tab && tab.review && tab.review.asks) || []).find(isChatAsk);
  if (!ask) return null;
  return {
    kind: 'ask',
    id: String(ask.id || ''),
    label: String(ask.question || ask.prompt || ''),
    why: String(ask.why || ''),
  };
}

function applyFocusEvent(tab, payload) {
  if (!tab || !payload) return tab && tab.chatTarget ? { ...tab.chatTarget } : null;
  if (!payload.focused) return tab.chatTarget || null;
  const id = String(payload.id || '');
  if (!id) return tab.chatTarget || null;
  const field = fieldById(tab, id);
  const focusId = (field && field.id) || id;
  tab.focusedFieldId = focusId;
  tab.reviewFocus = focusId;
  tab.reviewFlashId = focusId;
  tab.reviewFlashAt = Date.now();
  tab.chatTarget = {
    id: focusId,
    label: String((field && field.label) || payload.label || focusId),
    route: String((field && field.route) || payload.route || ''),
  };
  return tab.chatTarget;
}

function clearChatTarget(tab) {
  if (!tab) return null;
  tab.chatTarget = null;
  tab.focusedFieldId = '';
  return null;
}

function dismissChatTarget(tab) {
  if (!tab) return null;
  const teach = teachPendingFrom(tab);
  if (teach && teach.kind === 'ask' && tab.review && Array.isArray(tab.review.asks)) {
    const ask = tab.review.asks.find((a) => String(a.id || '') === String(teach.id || '') && !a.answered);
    if (ask) ask.answered = true;
  }
  return clearChatTarget(tab);
}

function clearIfFilled(tab, fieldId, state) {
  if (!tab || !tab.chatTarget || tab.chatTarget.id !== fieldId) return tab && tab.chatTarget;
  if (state === 'green' || state === 'skip') return clearChatTarget(tab);
  return tab.chatTarget;
}

function clearIfMissing(tab, fields) {
  if (!tab || !tab.chatTarget) return null;
  const id = tab.chatTarget.id;
  const list = Array.isArray(fields) ? fields : tab.debugFields || [];
  if (list.some((f) => f && f.id === id)) return tab.chatTarget;
  return clearChatTarget(tab);
}

function chromeTarget(tab) {
  const target = (tab && tab.chatTarget) || null;
  const teach = teachPendingFrom(tab);
  return {
    chatTarget: target,
    focusedFieldId: (target && target.id) || (tab && tab.focusedFieldId) || '',
    focusedFieldLabel: (target && target.label) || '',
    focusedFieldRoute: (target && target.route) || '',
    teachPending: teach,
    targetBarText: targetBarText(target, teach),
  };
}

function targetBarText(target, teach) {
  const row = (teach && teach.kind === 'ask' && teach) || target;
  if (!row || !row.label) return '';
  return String(row.label);
}

module.exports = {
  isChatAsk,
  teachPendingFrom,
  applyFocusEvent,
  clearChatTarget,
  dismissChatTarget,
  clearIfFilled,
  clearIfMissing,
  chromeTarget,
  targetBarText,
};
