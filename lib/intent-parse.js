const fs = require('fs');
const path = require('path');
const { addUrlsFromText, editList, extractUrls } = require('./discover');
const {
  compileSearchSchema,
  looksLikeSearch,
  toDiscoverCriteria,
  formatPlanReply,
  schemaReady,
} = require('../packages/core/src/search-schema');
const { formatCompanyHeld } = require('../packages/core/src/company-hold');

function loadDotEnv() {
  const p = path.join(__dirname, '..', '.env');
  try {
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (_) {}
}

function heuristicIntent(message) {
  const text = String(message || '').trim();
  const urls = extractUrls(text);
  if (/add these/i.test(text) || (urls.length && !/^find\b/i.test(text))) {
    return { action: 'add_urls', urls };
  }
  if (looksLikeSearch(text)) {
    const schema = compileSearchSchema(text);
    return {
      action: 'find',
      n: schema.n,
      schema,
      criteria: toDiscoverCriteria(schema),
    };
  }
  if (
    /connect(?:\s+my)?\s+g?mail/i.test(text) ||
    /sign in(?: to)? gmail/i.test(text) ||
    /(?:see|read|access|link|auth)\s+(?:my\s+)?gmail/i.test(text) ||
    /gmail (?:sign[- ]?in|oauth|connect)/i.test(text)
  ) {
    return { action: 'connect_mail' };
  }
  if (/scan\s+(?:my\s+)?(?:inbox|rejections|mail|email|gmail)/i.test(text)) {
    return { action: 'scan_mail' };
  }
  if (/remove company/i.test(text)) {
    const m = text.match(/remove company\s+(.+)/i);
    return { action: 'edit', edit: { remove_companies: m ? [m[1].trim()] : [] } };
  }
  if (/no military/i.test(text)) {
    return { action: 'edit', edit: { add_exclude_industries: ['military'] } };
  }
  if (urls.length) return { action: 'add_urls', urls };
  return {
    action: 'talk',
    reply: 'Describe the search (title, remote, pay, how many) or paste apply URLs.',
  };
}

async function spawnSdkIntent(message) {
  const ev = await require('./agent-client').invoke('intent', { message }, { timeout: 60000 });
  return ev.result || ev;
}

async function runIntent(message) {
  loadDotEnv();
  let intent;
  if (process.env.CURSOR_API_KEY) {
    try {
      intent = await spawnSdkIntent(message);
    } catch (err) {
      console.warn('[magnet] intent sdk, heuristic fallback:', err.message || err);
      intent = heuristicIntent(message);
    }
  } else {
    intent = heuristicIntent(message);
  }

  if (intent.action === 'add_urls') {
    const r = await addUrlsFromText(message);
    const heldBit = formatCompanyHeld(r.companyHeld);
    const jdBit = r.jds ? ` Captured ${r.jds} JDs.` : r.added ? ' No JD on those URLs — posting page may need a login.' : '';
    return { ok: true, intent, ...r, reply: `Added ${r.added}, ${r.dupes} dupes.${heldBit ? ` ${heldBit}` : ''}${jdBit}` };
  }
  if (intent.action === 'edit') {
    const r = editList(intent.edit || {});
    return { ok: true, intent, ...r, reply: `Removed ${r.removed} rows.` };
  }
  if (intent.action === 'connect_mail') {
    return { ok: true, intent, needConnect: true, reply: 'Opening Google sign-in…' };
  }
  if (intent.action === 'scan_mail') {
    return { ok: true, intent, needScan: true, reply: 'Scanning inbox…' };
  }
  if (intent.action === 'find') {
    const schema = intent.schema || compileSearchSchema(message);
    return {
      ok: true,
      intent,
      needApproval: schemaReady(schema),
      plan: schema,
      schema,
      reply: formatPlanReply(schema),
    };
  }
  if (intent.action === 'talk') {
    return { ok: true, intent, reply: intent.reply };
  }
  return { ok: false, reply: 'Could not parse that.', intent };
}

module.exports = { runIntent, heuristicIntent };
