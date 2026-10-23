/** HTTPS LLM port. Electron can wrap agent-host instead; mobile uses this. */

const { parseJsonBlob } = require('../../../lib/cascade');
const { sharedCustomTools, normalizeAsks } = require('../../../lib/chat-tools');

async function chatCompletions({ url, apiKey, model, system, user, tools }) {
  const endpoint = url || 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: model || 'gpt-4.1-mini',
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: user },
    ],
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `LLM HTTP ${res.status}`);
  }
  const json = await res.json();
  const msg = (json.choices && json.choices[0] && json.choices[0].message) || {};
  const text = msg.content || json.reply || '';
  return { reply: String(text), message: msg, drafts: [] };
}

function parseDrafts(text) {
  try {
    const parsed = parseJsonBlob(text);
    return {
      reply: parsed.reply || '',
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      asks: normalizeAsks(parsed.asks),
      parsed,
    };
  } catch {
    return { reply: String(text || ''), drafts: [], asks: [] };
  }
}

function asOpenAiTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read prior submitted essays from the applicant log.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            similar_to: { type: 'string' },
            company: { type: 'string' },
            limit: { type: 'number' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'askQuestion',
        description: 'Ask the applicant a structured question.',
        parameters: {
          type: 'object',
          properties: {
            questions: { type: 'array' },
          },
        },
      },
    },
  ];
}

function createFetchLlm(getConfig) {
  return {
    ready() {
      const cfg = (typeof getConfig === 'function' ? getConfig() : getConfig) || {};
      return Boolean(cfg.apiKey || cfg.llmKey);
    },
    async prompt(payload) {
      const cfg = (typeof getConfig === 'function' ? getConfig() : getConfig) || {};
      let prompt = payload.prompt || '';
      if (!prompt) {
        try {
          const { buildTurnPrompt } = require('../../../lib/cascade');
          prompt = buildTurnPrompt({
            company: payload.job && payload.job.company,
            title: payload.job && payload.job.title,
            instruction: payload.text || '',
            voice: payload.voice,
            system: payload.system,
            fields: payload.fields || [],
            jd: payload.jd,
            retrieved: payload.retrieved,
            retrieveCardIds: payload.retrieveCardIds,
            pickBodies: payload.pickBodies,
            history: payload.messages,
          });
        } catch {
          prompt = [
            payload.voice ? `Essay voice:\n${payload.voice}` : '',
            payload.job ? `Job: ${(payload.job.company || '')} — ${(payload.job.title || '')}` : '',
            payload.retrieved ? payload.retrieved : '',
            payload.text || '',
          ]
            .filter(Boolean)
            .join('\n\n');
        }
      }
      const traces = [];
      const asks = [];
      const tools = sharedCustomTools({ traces, asks });
      let user = prompt;
      const reuseText = payload.text || payload.instruction || '';
      if (payload.store && typeof payload.store.searchAnswers === 'function') {
        try {
          const { wantsReuseRead } = require('../../../lib/essay-prompt');
          if (wantsReuseRead(reuseText)) {
            const hits = payload.store.searchAnswers({
              query: reuseText,
              company: payload.job && payload.job.company,
              limit: 3,
            });
            if (hits && hits.length) {
              user += `\n\nPrior essays from the store:\n${hits
                .map((d) => `${d.company || ''} · ${d.label || ''}\n${String(d.text || '').slice(0, 700)}`)
                .join('\n\n')}`;
            }
          }
        } catch (_) {}
      }
      let parsed = { reply: '', drafts: [], asks: [] };
      for (let i = 0; i < 3; i += 1) {
        const out = await chatCompletions({
          url: cfg.url || cfg.llmUrl,
          apiKey: cfg.apiKey || cfg.llmKey,
          model: cfg.model || (cfg.settings && cfg.settings.modelId),
          system: payload.system || '',
          user,
          tools: i === 0 ? asOpenAiTools() : undefined,
        });
        const call = out.message && (out.message.tool_calls || [])[0];
        if (call && call.function && tools[call.function.name]) {
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            args = {};
          }
          const result = await tools[call.function.name].execute(args);
          user = `${prompt}\n\nTool ${call.function.name} result:\n${result}\n\nContinue. Return JSON only.`;
          continue;
        }
        parsed = parseDrafts(out.reply);
        break;
      }
      return {
        reply: parsed.reply || '',
        drafts: parsed.drafts || [],
        asks: [...asks, ...(parsed.asks || [])],
        tools: traces,
      };
    },
  };
}

module.exports = { createFetchLlm, chatCompletions, parseDrafts };
