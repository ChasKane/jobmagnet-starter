const { extractText } = require('./extract-text');

async function runPrompt({ name, prompt, tools } = {}) {
  if (process.env.NODE_TEST_CONTEXT && !process.env.MAGNET_AGENT_HOST) return '';
  if (process.env.MAGNET_AGENT_HOST === '1') {
    let Agent;
    try {
      ({ Agent } = require('@cursor/sdk'));
    } catch {
      return '';
    }
    const { promptText } = require('./cursor-agent');
    return extractText(await promptText(Agent, prompt, { name, tools: tools || [] }));
  }
  const client = require('./agent-client');
  const out = await client.prompt({ name, prompt, tools: tools || [] });
  return (out && out.text) || '';
}

module.exports = { runPrompt };
