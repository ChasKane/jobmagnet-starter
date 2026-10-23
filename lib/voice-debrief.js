const graph = require('./graph');
const { isEligibleFinal, applyRulesToVoice, hasProperNoun } = require('./voice-rules');
const { loadRichboi, saveRichboi } = require('./essay-prompt');
const { CHAT_TOOLS, sharedCustomTools, normalizeAsks, recordTrace } = require('./chat-tools');
const { append } = require('./action-log');

const ASK_ID = 'debrief-lessons';
const SHAPES = new Set(['why-us', 'proud-project', 'cover', 'conflict', 'failure', 'general']);

const OPTION = {
  all: { id: 'all', label: 'Keep all' },
  voice: { id: 'voice', label: 'Keep voice rules only' },
  binding: { id: 'binding', label: 'Keep story binding only' },
  skip: { id: 'skip', label: 'Skip' },
};

function eligiblePairs(rows) {
  return (rows || []).filter(isEligibleFinal);
}

function ruleId(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48) || 'rule'
  );
}

function sanitizeRules(rules) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rules) ? rules : []) {
    const text = String((r && r.text) || '').trim().slice(0, 240);
    if (!text || hasProperNoun(text)) continue;
    const id = ruleId((r && r.id) || text);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text });
    if (out.length >= 3) break;
  }
  return out;
}

function sanitizeBindings(bindings) {
  const out = [];
  const seen = new Set();
  for (const b of Array.isArray(bindings) ? bindings : []) {
    const question_shape = String((b && b.question_shape) || '')
      .trim()
      .toLowerCase();
    if (!SHAPES.has(question_shape)) continue;
    const tag = String((b && b.tag) || '')
      .trim()
      .toLowerCase();
    const card_id = String((b && b.card_id) || '').trim();
    if (!tag && !card_id) continue;
    const key = `${question_shape}:${card_id}:${tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ question_shape, tag: tag || null, card_id: card_id || null });
    if (out.length >= 3) break;
  }
  return out;
}

function sanitizeExperience(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((u) => ({
      employer: String((u && (u.employer || u.company)) || '').trim(),
      text: String((u && (u.text || u.bullets)) || '').trim(),
    }))
    .filter((u) => u.text)
    .slice(0, 4);
}

function emptyProposed() {
  return { voice_rules: [], bindings: [], experience_updates: [] };
}

function parseDebriefJson(blob) {
  const text = String(blob || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    const reply = text.trim();
    return { reply, asks: [], ...emptyProposed() };
  }
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return {
      reply: String(obj.reply || '').trim(),
      asks: normalizeAsks(obj.asks),
      voice_rules: sanitizeRules(obj.voice_rules || obj.rules),
      bindings: sanitizeBindings(obj.bindings),
      experience_updates: sanitizeExperience(obj.experience_updates),
    };
  } catch {
    return { reply: text.trim(), asks: [], ...emptyProposed() };
  }
}

function cannedAsks(proposed) {
  const hasVoice = Boolean(proposed && proposed.voice_rules && proposed.voice_rules.length);
  const hasBind = Boolean(proposed && proposed.bindings && proposed.bindings.length);
  const options = [];
  if (hasVoice && hasBind) options.push(OPTION.all, OPTION.voice, OPTION.binding);
  else if (hasVoice || hasBind) options.push(OPTION.all);
  if (!options.length) return [];
  options.push(OPTION.skip);
  return [
    {
      id: ASK_ID,
      prompt: 'Keep what Magnet learned from this apply?',
      options,
    },
  ];
}

function parseCannedChoice(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  if (/keep voice rules only|voice only/.test(t)) return 'voice';
  if (/keep story binding only|binding only/.test(t)) return 'binding';
  if (/keep all|keep both/.test(t)) return 'all';
  if (/→\s*skip\b/.test(t) || /^\s*skip\s*$/.test(t.trim()) || /\n→\s*skip\b/.test(t)) return 'skip';
  return null;
}

function pairsUserText(pairs, extra) {
  const bits = (pairs || []).map((p) => String((p && p.final) || '').trim()).filter(Boolean);
  const more = String(extra || '').trim();
  if (more) bits.push(more);
  return bits.join('\n');
}

function saveDebriefVoice(rules) {
  graph.ensureOpen();
  const clean = sanitizeRules(rules);
  if (!clean.length) return { row: graph.currentVoice(), wrote: false };
  const current = graph.currentVoice();
  const prev = (current && current.text) || loadRichboi();
  const next = applyRulesToVoice(prev, clean);
  if (String(next || '').trim() === String(prev || '').trim()) {
    return { row: current, wrote: false };
  }
  const row = graph.addVoiceVersion({
    kind: 'debrief',
    text: next,
    parent_id: current && current.id,
  });
  saveRichboi(next);
  append({
    request_id: `voice-${Date.now()}`,
    kind: 'voice.save',
    summary: 'debrief',
    extra: { voice_id: row.id },
  });
  return { row, wrote: true };
}

function applyBindings(bindings) {
  graph.ensureOpen();
  const out = [];
  for (const b of sanitizeBindings(bindings)) {
    const made = graph.addBinding({
      question_shape: b.question_shape,
      card_id: b.card_id,
      tag: b.tag,
      source: 'debrief',
    });
    if (made && made.kind !== 'no-op') out.push(made);
  }
  return out;
}

async function applyStories(updates, userText) {
  const { splitExperienceUpdates } = require('./profile-facts');
  const { applyExperienceUpdates } = require('./employment');
  const split = splitExperienceUpdates(updates || []);
  if (!split.cards.length) return [];
  return applyExperienceUpdates(split.cards, {
    userText: userText || '',
    source: 'chat',
  });
}

function formatAcceptReply(result, choice) {
  if (!result || choice === 'skip' || result.skipped) {
    return 'Okay, nothing saved from this apply.';
  }
  const bits = [];
  if (result.voiceWrote) bits.push('voice');
  if ((result.bindings || []).length) bits.push('story binding');
  if ((result.cards || []).length) bits.push('work notes');
  if (!bits.length) return 'Nothing new to keep from those edits.';
  return `Saved ${bits.join(' and ')} for the next draft.`;
}

async function acceptLessons(proposed, choice, opts = {}) {
  if (choice === 'skip' || !proposed) {
    return { skipped: true, voice: null, voiceWrote: false, bindings: [], cards: [] };
  }
  const includeVoice = choice === 'all' || choice === 'voice';
  const includeBindings = choice === 'all' || choice === 'binding';
  const includeStories = choice === 'all';
  const rules = includeVoice ? proposed.voice_rules : [];
  const binds = includeBindings ? proposed.bindings : [];
  const stories = includeStories ? proposed.experience_updates : [];
  const voiceOut = saveDebriefVoice(rules);
  const bindings = applyBindings(binds);
  const userText = pairsUserText(opts.pairs, opts.userText);
  const cards = stories.length ? await applyStories(stories, userText) : [];
  return {
    skipped: false,
    voice: voiceOut.row,
    voiceWrote: Boolean(voiceOut.wrote),
    bindings,
    cards,
  };
}

function skipLessons() {
  return { skipped: true, voice: null, voiceWrote: false, bindings: [], cards: [] };
}

function debriefContext() {
  graph.ensureOpen();
  const voice = graph.currentVoice();
  return {
    voice: (voice && voice.text) || loadRichboi() || '',
    cards: graph.cardIndex({ minConfidence: 'any' }).map((c) => ({
      id: c.id,
      employer: c.employer,
      claim: c.claim,
      tags: c.tags || [],
    })),
    bindings: graph.bindingsFor(''),
  };
}

function formatPairs(pairs) {
  return (pairs || [])
    .map((p, i) => {
      const draft = String((p && p.llm_draft) || '').trim();
      const finalText = String((p && p.final) || '').trim();
      if (!finalText) return '';
      const cards = Array.isArray(p.source_card_ids) && p.source_card_ids.length
        ? `Magnet cards: ${p.source_card_ids.join(', ')}\n`
        : '';
      return `## Edit ${i + 1}\nQuestion: ${(p && p.label) || ''}\n${cards}Draft:\n${draft.slice(0, 1200)}\n\nFinal:\n${finalText.slice(0, 1800)}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function buildDebriefOpenPrompt(payload = {}) {
  const ctx = payload.context || debriefContext();
  const company = String(payload.company || '').trim();
  return `You are Magnet, sitting next to the applicant. Diagnose how Magnet's drafts missed their edits on this apply. Chat voice, not essay voice. Complete sentences.

Propose at most 3 reusable lessons. Split them:
- voice_rules: imperative lines that work at the next company. No employer names, product names, or proper nouns. Write "Describe the tool; do not name it." not a recap of this essay.
- bindings: which story to use for a question shape (why-us, proud-project, cover, conflict, failure, general). Use tag or card_id from the index. Bindings MAY name a card; voice_rules must not. If a rewritten final still sits on the same Magnet cards (source_card_ids listed on the edit), propose a binding for that question shape.
- experience_updates: only a new work-story fact they wrote in a final, quoted closely. Empty if the final did not add a fact.

Empty arrays are correct when the edits do not teach that kind of lesson.

Current voice:
${String(ctx.voice || '').slice(0, 4000)}

Card index:
${JSON.stringify((ctx.cards || []).slice(0, 40))}

Existing bindings:
${JSON.stringify(ctx.bindings || [])}

${company ? `Company (for your reply only; do not put it in voice_rules): ${company}\n` : ''}${formatPairs(payload.pairs) || '(no edits)'}

Return JSON only:
{"reply":"what Magnet did wrong, in complete sentences","voice_rules":[{"id":"kebab-id","text":"one imperative rule"}],"bindings":[{"question_shape":"why-us","tag":"ops-platform","card_id":""}],"experience_updates":[{"employer":"","text":""}]}`;
}

function buildDebriefFollowUpPrompt(payload = {}) {
  const history = Array.isArray(payload.history) ? payload.history : [];
  const hist = history
    .slice(-12)
    .map((m) => `${m.role === 'you' ? 'Applicant' : 'Magnet'}: ${String(m.text || '').slice(0, 800)}`)
    .join('\n');
  return `You are Magnet. The applicant is confirming or tweaking lessons from the last apply. Do not draft essays.

Pending proposal (JSON):
${JSON.stringify(payload.proposed || emptyProposed())}

Use tools. Call accept_lessons when they keep some or all lessons (pass edited voice_rules / bindings if they rewrote a line). Call skip_lessons when they want nothing saved. Call save_story if they stated a new work-story fact in this message, quoting them. Then reply in readable sentences, no JSON fence.

${hist ? `Recent chat:\n${hist}\n` : ''}Applicant: ${String(payload.instruction || '')}`;
}

function debriefTools(state) {
  const { traces, asks, actions, proposed, pairs, userText } = state;
  return {
    ...sharedCustomTools({ traces, asks }),
    accept_lessons: {
      description:
        'Write confirmed voice rules and/or story bindings from the pending proposal. Pass edited arrays when the applicant rewrote a line. Omit an array to keep the pending one. include_voice / include_bindings default true.',
      inputSchema: {
        type: 'object',
        properties: {
          include_voice: { type: 'boolean' },
          include_bindings: { type: 'boolean' },
          voice_rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, text: { type: 'string' } },
            },
          },
          bindings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question_shape: { type: 'string' },
                tag: { type: 'string' },
                card_id: { type: 'string' },
              },
            },
          },
        },
      },
      annotations: { title: 'Accept lessons' },
      async execute(args) {
        const next = {
          voice_rules:
            args && args.voice_rules ? sanitizeRules(args.voice_rules) : (proposed && proposed.voice_rules) || [],
          bindings: args && args.bindings ? sanitizeBindings(args.bindings) : (proposed && proposed.bindings) || [],
          experience_updates: (proposed && proposed.experience_updates) || [],
        };
        const includeVoice = args && args.include_voice === false ? false : true;
        const includeBindings = args && args.include_bindings === false ? false : true;
        let choice = 'all';
        if (includeVoice && !includeBindings) choice = 'voice';
        else if (!includeVoice && includeBindings) choice = 'binding';
        else if (!includeVoice && !includeBindings) choice = 'skip';
        const result = await acceptLessons(next, choice, { pairs, userText });
        Object.assign(actions, result);
        actions.accepted = !result.skipped;
        const out = formatAcceptReply(result, choice);
        recordTrace(traces, 'accept_lessons', args || {}, out);
        return out;
      },
    },
    skip_lessons: {
      description: 'Do not save voice rules or bindings from this apply.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Skip lessons' },
      execute() {
        const result = skipLessons();
        Object.assign(actions, result);
        const out = formatAcceptReply(result, 'skip');
        recordTrace(traces, 'skip_lessons', {}, out);
        return out;
      },
    },
    save_story: {
      description:
        'Save work-story facts the applicant just said onto career cards. Quote their wording. Do not invent.',
      inputSchema: {
        type: 'object',
        properties: {
          stories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                employer: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['text'],
            },
          },
        },
        required: ['stories'],
      },
      annotations: { title: 'Save work story' },
      async execute(args) {
        const { storyConfirmAsks } = require('./story-confirm');
        const { splitExperienceUpdates } = require('./profile-facts');
        const stories = Array.isArray(args && args.stories) ? args.stories : [];
        const split = splitExperienceUpdates(stories);
        const next = storyConfirmAsks(split.cards);
        if (next.length) asks.push(...next);
        const out = next.length
          ? 'Shown in chat — Keep, edit employer, or Skip.'
          : 'Nothing to file.';
        recordTrace(traces, 'save_story', args, out);
        return out;
      },
    },
  };
}

function packProposed(parsed) {
  return {
    voice_rules: parsed.voice_rules || [],
    bindings: parsed.bindings || [],
    experience_updates: parsed.experience_updates || [],
  };
}

function hasLessons(proposed) {
  return Boolean(
    (proposed && proposed.voice_rules && proposed.voice_rules.length) ||
      (proposed && proposed.bindings && proposed.bindings.length) ||
      (proposed && proposed.experience_updates && proposed.experience_updates.length)
  );
}

async function llmRaw(prompt, ctx, extra) {
  if (ctx && ctx.promptText && ctx.Agent) {
    const extract =
      ctx.extractText ||
      ((result) => {
        if (result == null) return '';
        if (typeof result === 'string') return result;
        const r = result.result ?? result.text ?? result.output ?? result.message;
        if (typeof r === 'string') return r;
        return JSON.stringify(r || '');
      });
    return extract(await ctx.promptText(ctx.Agent, prompt, extra || { name: 'jobmagnet-debrief', tools: [] }));
  }
  const { runPrompt } = require('./llm-call');
  return runPrompt({ name: 'jobmagnet-debrief', prompt, tools: (extra && extra.tools) || [] });
}

async function runDebriefOpen(payload = {}, ctx = {}) {
  const pairs = eligiblePairs(payload.pairs || payload.rows);
  const parsed = payload.parsed
    ? {
        reply: String(payload.parsed.reply || '').trim(),
        ...packProposed({
          voice_rules: sanitizeRules(payload.parsed.voice_rules || payload.parsed.rules),
          bindings: sanitizeBindings(payload.parsed.bindings),
          experience_updates: sanitizeExperience(payload.parsed.experience_updates),
        }),
      }
    : parseDebriefJson(await llmRaw(buildDebriefOpenPrompt({ ...payload, pairs }), ctx));
  const proposed = packProposed(parsed);
  const asks = hasLessons(proposed) ? cannedAsks(proposed) : [];
  const reply =
    parsed.reply ||
    (asks.length
      ? 'Magnet missed some of those essay edits. Keep the lessons for the next draft?'
      : 'Those edits did not teach a reusable pattern.');
  return {
    ok: true,
    reply,
    asks,
    proposed,
    empty: !asks.length,
  };
}

async function runDebriefTurn(payload = {}, ctx = {}) {
  const traces = [];
  const asks = [];
  const actions = {};
  const extra = {
    name: 'jobmagnet-debrief',
    tools: CHAT_TOOLS,
    customTools: debriefTools({
      traces,
      asks,
      actions,
      proposed: payload.proposed || emptyProposed(),
      pairs: payload.pairs || [],
      userText: payload.instruction || '',
    }),
  };
  const raw = await llmRaw(buildDebriefFollowUpPrompt(payload), ctx, extra);
  const reply = String(raw || '').trim() || formatAcceptReply(actions, actions.skipped ? 'skip' : 'all');
  return {
    ok: true,
    reply,
    asks: normalizeAsks(asks),
    tools: traces,
    proposed: payload.proposed,
    accepted: Boolean(actions.accepted),
    skipped: Boolean(actions.skipped),
    voice: actions.voice || null,
    bindings: actions.bindings || [],
    cards: actions.cards || [],
  };
}

async function runDebrief(payload = {}, ctx = {}) {
  if (payload.followUp) return runDebriefTurn(payload, ctx);
  return runDebriefOpen(payload, ctx);
}

module.exports = {
  ASK_ID,
  eligiblePairs,
  sanitizeRules,
  sanitizeBindings,
  parseDebriefJson,
  cannedAsks,
  parseCannedChoice,
  saveDebriefVoice,
  applyBindings,
  acceptLessons,
  skipLessons,
  formatAcceptReply,
  buildDebriefOpenPrompt,
  buildDebriefFollowUpPrompt,
  debriefTools,
  runDebriefOpen,
  runDebriefTurn,
  runDebrief,
  hasLessons,
  emptyProposed,
};
