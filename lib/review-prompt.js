const fs = require('fs');
const path = require('path');
const { slimFindings } = require('./audit');
const { listRecipes } = require('./field-recipes');
const { load: loadProfile, profileFacts, rawYaml } = require('./profile-facts');

const REVIEW_MD = path.join(__dirname, '..', 'knowledge', 'review-prompt.md');

function saveReviewRules(text) {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().setReviewPrompt(text);
  }
  fs.mkdirSync(path.dirname(REVIEW_MD), { recursive: true });
  fs.writeFileSync(REVIEW_MD, String(text ?? ''), 'utf8');
  return loadReviewRules();
}

function loadReviewRules() {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().getReviewPrompt();
  }
  try {
    return fs.readFileSync(REVIEW_MD, 'utf8');
  } catch {
    return '';
  }
}

function clipHtml(s, max) {
  const t = String(s || '');
  const cap = max || 24000;
  return t.length > cap ? t.slice(0, cap) : t;
}

function slimRecipes() {
  return listRecipes().map((r) => ({
    label_key: r.label_key,
    label_includes: r.label_includes,
    shape: r.shape || null,
    has_steps: Boolean(r.steps && r.steps.length),
    steps: (r.steps || []).slice(0, 16),
    has_run: Boolean(r.run && r.run.source),
  }));
}

function slimOutline(field) {
  return {
    id: field.id,
    label: field.label,
    heading: field.heading || '',
    type: field.type || field.tag || '',
    clusterId: field.clusterId || '',
    options: (field.options || []).slice(0, 12),
  };
}

function slimResidual(field) {
  let klass = field.class || '';
  try {
    if (!klass) klass = require('./question-class').classifyQuestion(field).class || '';
  } catch (_) {}
  return {
    id: field.id,
    label: field.label,
    heading: field.heading || '',
    widget: field.tag || field.type,
    required: Boolean(field.required),
    route: field.route,
    reason: field.reason,
    class: klass,
    magnet_state: field.magnetState || '',
    intended: field.intended || '',
    current: field.current || '',
    residual: field.residual,
    fill: field.fill || null,
    options: (field.options || []).slice(0, 24),
    validation: field.validation || '',
    recipe: field.recipeHit || null,
    clusterId: field.clusterId || '',
  };
}

function clusterHtmlBlock(residuals) {
  const seen = new Set();
  const out = [];
  for (const f of residuals || []) {
    const html = f.clusterHtml || f.hostHtml || '';
    if (!html) continue;
    const key = html.slice(0, 240);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: f.id,
      clusterId: f.clusterId || '',
      host_html: clipHtml(f.hostHtml, 12000),
      cluster_html: clipHtml(f.clusterHtml, 40000),
    });
    if (out.length >= 16) break;
  }
  return out;
}

function slimChatDigest(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice(-8)
    .map((m) => ({
      role: m && m.role ? String(m.role) : '',
      text: String((m && m.text) || '').slice(0, 400),
    }))
    .filter((m) => m.text);
}

function slimPrior(prior) {
  if (!prior || typeof prior !== 'object') return null;
  const fills = Array.isArray(prior.fills) ? prior.fills : [];
  const asks = Array.isArray(prior.asks) ? prior.asks : [];
  if (!fills.length && !asks.length && !prior.reply) return null;
  return {
    reply: String(prior.reply || '').slice(0, 400),
    fills: fills.slice(0, 24).map((f) => ({
      id: f.id,
      label: f.label || '',
      value: f.value || '',
      reason: f.reason || '',
    })),
    asks: asks.slice(0, 24).map((a) => ({
      id: a.id || '',
      question: a.question || '',
      why: a.why || '',
      reason: a.reason || '',
    })),
  };
}

function buildReviewPrompt({ residuals, fields, findings, instruction, allowRuns, chat_digest, focus_id, prior, pageHtml }) {
  const profile = loadProfile();
  const payload = {
    profile_yaml: rawYaml(),
    profile: profileFacts(profile),
    recipes: slimRecipes(),
    form_outline: (fields || []).slice(0, 80).map(slimOutline),
    residuals: (residuals || []).map(slimResidual),
    cluster_html: clusterHtmlBlock(residuals),
    page_html: clipHtml(pageHtml, 400000),
    findings: slimFindings(findings),
    instruction: instruction || '',
    allow_runs: Boolean(allowRuns),
    focus_id: focus_id ? String(focus_id) : '',
    chat_digest: slimChatDigest(chat_digest),
    prior: slimPrior(prior),
    catalog_classes: require('./question-catalog').ROWS.map((r) => r.id),
  };
  const rules = loadReviewRules();
  return {
    prompt: `${rules}\n\n---\n\nInput:\n${JSON.stringify(payload, null, 2)}\n`,
    payload,
  };
}

module.exports = { buildReviewPrompt, profileFacts, loadReviewRules, saveReviewRules, clusterHtmlBlock };
