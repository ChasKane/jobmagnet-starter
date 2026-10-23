const { slimFindings } = require('./audit');
const { scanFormQuestions } = require('./jd-scan');

function alertKey(finding) {
  if (!finding) return '';
  return [finding.kind, finding.id, finding.phrase || finding.summary, finding.fieldId]
    .map((part) => String(part || ''))
    .join('|');
}

function collectAlertFindings(tab) {
  const jd = slimFindings(tab && tab.jd && tab.jd.findings);
  const form = scanFormQuestions((tab && tab.debugFields) || []).findings;
  const out = [];
  const seen = new Set();
  for (const finding of [...jd, ...form]) {
    const key = alertKey(finding);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

function takeNewAlerts(tab, findings) {
  const seen = new Set((tab && tab.surfacedAlerts) || []);
  const fresh = [];
  for (const finding of findings || []) {
    const key = alertKey(finding);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(finding);
  }
  if (tab) tab.surfacedAlerts = [...seen];
  return fresh;
}

function formatAlertChat(findings) {
  const list = Array.isArray(findings) ? findings.filter((f) => f && f.summary) : [];
  if (!list.length) return '';
  if (list.length === 1) return `Gotcha — ${list[0].summary}`;
  return `Gotchas\n${list.map((f) => `• ${f.summary}`).join('\n')}`;
}

function faultText(result, tab) {
  return String(
    (result && (result.error || (result.received && result.received.error))) || (tab && tab.essayError) || ''
  ).trim();
}

function chatFolds(result, tab) {
  const err = faultText(result, tab);
  if (!err) return [];
  return [{ level: 'error', label: 'error', text: err }];
}

function shouldPing(kind, result, extras = {}) {
  if (result && result.cancelled) return false;
  const failed = Boolean(result && (result.ok === false || result.error));
  if (kind === 'jd' || kind === 'resume') return failed || Boolean(extras.hasAlerts);
  return true;
}

function silentFail(result) {
  if (!result || result.cancelled) return true;
  if (result.ok !== false && !result.error) return false;
  return !String(result.reply || '').trim();
}

module.exports = {
  alertKey,
  collectAlertFindings,
  takeNewAlerts,
  formatAlertChat,
  faultText,
  chatFolds,
  shouldPing,
  silentFail,
};
