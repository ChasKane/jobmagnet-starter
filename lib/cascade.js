const { loadSystemPrompt, loadRichboi, leftoverBlock } = require('./essay-prompt');
const { looksLikeApplyForm } = require('./chat-intent');
const { formatCardForDraft, draftProductBlock } = require('./products');
const graph = require('./graph');
const { append } = require('./action-log');
const { CHAT_TOOLS, sharedCustomTools } = require('./chat-tools');

function parseJsonBlob(blob) {
  const text = String(blob || '');
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
    const end = text.lastIndexOf(']');
    if (end > arrStart) {
      const parsed = JSON.parse(text.slice(arrStart, end + 1));
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
        return {
          shape: parsed[0].shape,
          strategy: parsed.map((p) => p.strategy).filter(Boolean).join('\n'),
          need: parsed.flatMap((p) => p.need || []),
          ids: parsed.flatMap((p) => (Array.isArray(p.ids) ? p.ids : [])),
        };
      }
    }
  }
  if (objStart < 0) throw new Error('cascade: no JSON object');
  const end = text.lastIndexOf('}');
  if (end <= objStart) throw new Error('cascade: no JSON object');
  return JSON.parse(text.slice(objStart, end + 1));
}

function inferShape(fields, instruction) {
  const blob = `${instruction || ''} ${(fields || []).map((f) => f.label || '').join(' ')}`.toLowerCase();
  if (/proud|favorite project|project you.re proud/.test(blob)) return 'proud-project';
  if (/why[- ]?(this|the|us|apply)|why do you want|interest/.test(blob)) return 'why-us';
  if (/cover letter/.test(blob)) return 'cover';
  if (/conflict|disagre|stakeholder/.test(blob)) return 'conflict';
  if (/fail|mistake|wrong/.test(blob)) return 'failure';
  return 'general';
}

function jdSkeleton(payload) {
  const jd = (payload.jd && payload.jd.text) || '';
  const formJd = looksLikeApplyForm(jd);
  return {
    formJd,
    text: jd.slice(0, formJd ? 2500 : 8000),
    hint: formJd
      ? 'This JD block looks like the apply form, not the posting. Fetch careers/about before why-us.\n'
      : '',
  };
}

function historyBlock(payload) {
  const history = Array.isArray(payload.history) ? payload.history : [];
  if (!history.length) return '';
  const blob = history
    .map((m) => {
      const extra = (m.drafts || [])
        .map((d) => String((d && d.text) || '').trim())
        .filter(Boolean)
        .join('\n');
      const line = `${m.role}: ${m.text || ''}`;
      return extra ? `${line}\n[drafts]:\n${extra}` : line;
    })
    .join('\n');
  return `Recent chat on this job tab:\n${blob.length > 8000 ? blob.slice(blob.length - 8000) : blob}\n`;
}

function loadTurnBindings(payload) {
  if (payload.bindings != null) return Array.isArray(payload.bindings) ? payload.bindings : [];
  try {
    graph.ensureOpen();
    return graph.bindingsFor(inferShape(payload.fields, payload.instruction));
  } catch (_) {
    return [];
  }
}

function indexWithBindings(index, bindings) {
  const filtered = graph.filterIndex(index || [], bindings || []);
  return filtered.length ? filtered : index || [];
}

function loadTurnBodies(payload) {
  if (Array.isArray(payload.bodies) && payload.bodies.length) return payload.bodies;
  if (typeof payload.pickBodies === 'function') {
    try {
      return payload.pickBodies(payload) || [];
    } catch (_) {
      return [];
    }
  }
  try {
    graph.ensureOpen();
    const shape = inferShape(payload.fields, payload.instruction);
    const bindings = loadTurnBindings({ ...payload, shape });
    const boundIds = bindings.map((b) => b.card_id).filter(Boolean);
    const boundTags = bindings.map((b) => b.tag).filter(Boolean);
    const index = graph.cardIndex() || [];
    let ids = index
      .filter((c) => boundIds.includes(c.id) || (c.tags || []).some((t) => boundTags.includes(t)))
      .map((c) => c.id);
    const extra = Array.isArray(payload.retrieveCardIds) ? payload.retrieveCardIds.map(String) : [];
    if (!ids.length && !extra.length) {
      const words = `${payload.instruction || ''} ${payload.company || ''} ${payload.title || ''} ${(
        payload.fields || []
      )
        .map((f) => f.label || '')
        .join(' ')}`
        .toLowerCase()
        .split(/[^a-z0-9+#]+/i)
        .filter((w) => w.length > 3);
      ids = index
        .filter((c) => {
          const blob = `${c.employer || ''} ${c.claim || ''} ${(c.tags || []).join(' ')}`.toLowerCase();
          return !words.length || words.some((w) => blob.includes(w));
        })
        .slice(0, 6)
        .map((c) => c.id);
    }
    return graph.cardBodies([...new Set(ids.concat(extra))]);
  } catch (_) {
    return [];
  }
}

function loadTurnVoice(payload) {
  if (payload.voice != null) return String(payload.voice);
  try {
    const row = graph.currentVoice();
    if (row && row.text) return row.text;
  } catch (_) {}
  return loadRichboi();
}

function loadShapeRubric(payload) {
  if (payload.rubric != null) return payload.rubric;
  if (process.env.NODE_TEST_CONTEXT && !payload.loadRubric) return null;
  try {
    const { bestPriorForShape } = require('./prior-drafts');
    return bestPriorForShape(payload);
  } catch (_) {
    return null;
  }
}

function buildTurnPrompt(payload = {}) {
  const system = loadSystemPrompt().trim();
  const voice = loadTurnVoice(payload);
  const bodies = loadTurnBodies(payload);
  const jd = jdSkeleton(payload);
  const instruction = String(payload.instruction || '').trim();
  const shape = inferShape(payload.fields, instruction);
  const rubric = loadShapeRubric({ ...payload, shape });
  const rubricBlock = rubric && rubric.rubric
    ? `

Applicant rewrite of this shape (rubric — match length, stance, and ownership bounds; do not copy company names). If this draft looks like a Magnet-origin prior they already rewrote, bounce and match this version:
${String(rubric.rubric).slice(0, 900)}`
    : '';
  const bound = loadTurnBindings(payload);
  const bindHint = bound.length
    ? `Honor bindings for this question shape (prefer these cards/tags unless they clearly do not fit):\n${JSON.stringify(bound)}\n`
    : '';
  const writeHint = instruction
    ? 'There is a user message. Follow When to write on the field. Infer advise vs write vs lookup vs Magnet-bug from that line; there is no mode. If they asked to write or treat a focused field as an essay, emit drafts[] onto that id. Leave drafts empty unless they asked to put text on the field. Name employers and products in reply; never write internal card ids.'
    : 'No user message. Write listed empty fields. Prefer applicant-written current text when it is already on a field.';
  const closer = payload.seed
    ? 'Do not emit JSON yet. This is context only. Wait for the next applicant line.'
    : `Return JSON only after Stage 4: {"reply":"string","drafts":[{"id":"field-id","text":"draft"}],"experience_updates":[{"employer":"string","text":"string"}],"profile_updates":[{"path":"identity.age","value":30}]}
experience_updates only for work-story facts the applicant just said in chat, quoted closely.
profile_updates for closed facts they just stated (age, skill years, pay, work auth, EEO). Do not invent. Do not put stories on the profile.
Use only the source cards as evidence.
If a listed question has non-empty current and the user asked how to finish / how might / what should / ideas, leave drafts empty and recommend in reply unless they explicitly asked to put text on the field.
${payload.retrieved ? 'Prior essays above were retrieved for this turn. Adapt them; do not invent.' : 'If the applicant asks to reuse, show, or start from a previous answer, call the read tool first (query / similar_to / limit / company).'}`;
  return `${system}

Essay voice is a hard constraint on every drafts[].text. Chat reply stays Magnet, not this voice.
${voice || ''}

## Stage 1 Strategy
Plan the answer in this turn. Shape guess: ${shape}. Name the hook, what a canary would fail, and what proof you need. Do not emit JSON yet.

## Stage 2 Select
Pick 1-2 cards from the dump below. In reply, name the employer or product a person would recognize. Never write internal card ids, tags, or source_card_ids in reply or drafts. Do not invent work that is not in a card. Do not emit JSON yet.
${bindHint}

## Stage 3 Draft
Write Magnet reply plus optional drafts[]. Keep applicant current wording. ${writeHint}
Do not emit JSON yet.

## Stage 4 Review
Check voice, truth to the selected cards, strategy, and applicant current. If current is non-empty, do not replace their joke, links, or lead unless they asked for a rewrite. reply must describe the drafts you emit — if you drop lines, you may not say you kept them. nits is not a second writer.${rubricBlock} Then emit once.

${draftProductBlock()}
Source cards — the ONLY work you may cite. If a fact is not in a card, ask or omit it. Tags are internal. Never write JobMagnet or Job Magnet in a draft.
${bodies.map((b) => formatCardForDraft(b)).join('\n\n') || '(no cards)'}

Company: ${payload.company || ''}
Title: ${payload.title || ''}
${payload.retrieved ? `Retrieved context (prior essays / named cards / URLs):\n${payload.retrieved}\n` : ''}${instruction ? `User message:\n${instruction}\n` : ''}${historyBlock(payload)}${jd.hint}JD (trimmed):\n${jd.text}
Questions (id, label, maxLength, current):
${JSON.stringify(payload.fields || [])}
${leftoverBlock(payload)}

${closer}`;
}

function draftUsesOnlyCards(prompt, ids) {
  const start = prompt.indexOf('Source cards');
  const end = prompt.indexOf('Company:');
  const window = start >= 0 ? prompt.slice(start, end > start ? end : undefined) : prompt;
  for (const id of ids || []) {
    if (!window.includes(id)) return false;
  }
  return true;
}

const CASCADE_STAGE = {
  reply: { stage: 'reply', detail: 'Thinking…', busy: '' },
  retrieve: { stage: 'retrieve', detail: 'Retrieving…', busy: '' },
};

function draftToolOpts(payload, { traces, asks } = {}) {
  return {
    name: 'jobmagnet-draft',
    tools: CHAT_TOOLS.slice(),
    customTools: sharedCustomTools({ traces: traces || [], asks: asks || [] }),
  };
}

function logStep(requestId, kind, summary, blobs, extra) {
  append({ request_id: requestId, kind, summary, blobs, extra });
}

async function completeModelTurn(prompt, payload, { promptText, Agent, requestId, extractText, sendDraft, onDrafts, tools, kind }) {
  const traces = [];
  const asks = [];
  const extra = draftToolOpts(payload, { traces, asks });
  if (Array.isArray(tools)) extra.tools = tools;
  const take = extractText || ((r) => (r && (r.result || r.text)) || String(r || ''));
  const raw = sendDraft
    ? await sendDraft(prompt, { extra, traces, asks })
    : take(await promptText(Agent, prompt, extra));
  logStep(requestId, kind || 'cascade.turn', '', { prompt, retrieved: (payload && payload.retrieved) || '' });
  let parsed;
  try {
    parsed = parseJsonBlob(raw);
  } catch (err) {
    if (!String((payload && payload.instruction) || '').trim()) throw err;
    parsed = { reply: String(raw || '').trim(), drafts: [], experience_updates: [] };
  }
  if (onDrafts && (parsed.drafts || []).length) onDrafts(parsed.drafts);
  return {
    parsed,
    prompt,
    asks,
    tools: traces,
    raw,
    request_id: requestId,
    strategy: '',
    selected: Array.isArray(parsed.selected)
      ? parsed.selected
      : Array.isArray(parsed.ids)
        ? parsed.ids
        : [],
  };
}

async function runCascade(payload, { promptText, Agent, requestId, extractText, onProgress, sendDraft, onDrafts }) {
  const bodies = loadTurnBodies(payload);
  const voiceRow = (() => {
    try {
      return graph.currentVoice();
    } catch (_) {
      return null;
    }
  })();
  if (onProgress) onProgress(CASCADE_STAGE.reply);
  if (payload.retrieved && onProgress) onProgress(CASCADE_STAGE.retrieve);

  const prompt = buildTurnPrompt({ ...payload, bodies, voice: loadTurnVoice(payload) });
  const out = await completeModelTurn(prompt, payload, {
    promptText,
    Agent,
    requestId,
    extractText,
    sendDraft,
    onDrafts,
    kind: 'cascade.turn',
  });
  logStep(requestId, 'cascade.cards', `${bodies.length} cards`, { bodies }, { voice_version_id: voiceRow && voiceRow.id });
  return out;
}

module.exports = {
  inferShape,
  parseJsonBlob,
  buildTurnPrompt,
  draftUsesOnlyCards,
  draftToolOpts,
  CASCADE_STAGE,
  runCascade,
  completeModelTurn,
  jdSkeleton,
  historyBlock,
  loadTurnBodies,
  loadTurnVoice,
  loadTurnBindings,
  loadShapeRubric,
  indexWithBindings,
  CHAT_TOOLS,
};
