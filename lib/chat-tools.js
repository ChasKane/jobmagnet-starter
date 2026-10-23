// Cursor agent `tools` values (webSearch, webFetch, mcp). `mcp` exposes customTools.
// Do not define customTools named webSearch or webFetch — those are Cursor's.

const CHAT_TOOLS = ['webSearch', 'webFetch', 'mcp'];

function slimTrace(value, max = 1600) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function normalizeAsks(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.questions)
      ? raw.questions
      : raw && (raw.prompt || raw.question)
        ? [raw]
        : [];
  return list
    .map((q, i) => {
      if (!q) return null;
      const prompt = String(q.prompt || q.question || q.text || '').trim();
      if (!prompt) return null;
      const options = (Array.isArray(q.options) ? q.options : [])
        .map((o, j) => {
          if (o == null) return null;
          if (typeof o === 'string') return { id: `opt-${j}`, label: o };
          const label = String(o.label || o.text || o.value || '').trim();
          if (!label) return null;
          return { id: String(o.id || `opt-${j}`), label };
        })
        .filter(Boolean);
      return {
        id: String(q.id || `ask-${i + 1}`),
        prompt,
        options,
        allow_multiple: Boolean(q.allow_multiple || q.allowMultiple),
        answered: Boolean(q.answered),
        kind: q.kind ? String(q.kind) : '',
        story: q.story && typeof q.story === 'object' ? q.story : null,
        why: q.why ? String(q.why) : '',
      };
    })
    .filter(Boolean);
}

function formatAskAnswers(asks, answers) {
  return (asks || [])
    .map((q) => {
      const raw = answers && answers[q.id];
      const value = Array.isArray(raw) ? raw.filter(Boolean).join(', ') : String(raw || '').trim();
      if (!value) return '';
      return `${q.prompt}\n→ ${value}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function recordTrace(traces, name, args, result) {
  traces.push({
    name,
    args: args || {},
    result: slimTrace(result),
  });
}

function sharedCustomTools({ traces, asks }) {
  return {
    read: {
      description:
        'Read prior submitted essays from the applicant log. Use when they ask to reuse, show, or start from a previous answer (last similar question, last 3 essays, a named company).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Substring match on company, question, or text' },
          similar_to: { type: 'string', description: 'Current question label to find similar essays' },
          company: { type: 'string', description: 'Restrict to this company name' },
          limit: { type: 'number', description: 'Max essays (1-8, default 3)' },
        },
      },
      annotations: { title: 'Read prior essays', readOnlyHint: true },
      execute(args) {
        const { searchAnswers } = require('./prior-drafts');
        const rows = searchAnswers(args || {});
        const out = rows.length
          ? rows
              .map(
                (d) =>
                  `${d.company} · ${d.label} · ${d.origin || 'unknown'} · ${d.ts}\n${d.text.slice(0, 1200)}`
              )
              .join('\n\n')
          : 'No matching prior essays.';
        recordTrace(traces, 'read', args, out);
        return out;
      },
    },
    askQuestion: {
      description:
        'Ask the applicant a structured multiple-choice or short question. Use when you need a decision before acting.',
      inputSchema: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                prompt: { type: 'string' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { id: { type: 'string' }, label: { type: 'string' } },
                  },
                },
                allow_multiple: { type: 'boolean' },
              },
              required: ['prompt'],
            },
          },
        },
        required: ['questions'],
      },
      annotations: { title: 'Ask question', readOnlyHint: true },
      execute(args) {
        const next = normalizeAsks(args);
        asks.push(...next);
        const preview = next.map((q) => q.prompt).join(' | ') || 'Question queued.';
        recordTrace(traces, 'askQuestion', args, preview);
        return 'Shown in the JobMagnet chat UI. Wait for the applicant’s next message; do not invent their answer.';
      },
    },
  };
}

module.exports = {
  CHAT_TOOLS,
  slimTrace,
  normalizeAsks,
  formatAskAnswers,
  recordTrace,
  sharedCustomTools,
};
