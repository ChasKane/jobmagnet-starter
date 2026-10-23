#!/usr/bin/env node
const { Agent } = require('undici');
const BASE = process.env.MAGNET_URL || 'http://127.0.0.1:3871';
// Ingest hunts hold the response open until the search finishes. Undici's
// default headers timeout is 5 minutes, which drops that connection early.
const longFetch = new Agent({
  headersTimeout: 25 * 60 * 1000,
  bodyTimeout: 25 * 60 * 1000,
  connectTimeout: 30 * 1000,
});

function flag(name) {
  return process.argv.includes(name);
}

function opt(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function req(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    dispatcher: longFetch,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    console.error(data);
    process.exit(1);
  }
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case 'tabs':
    case 'list':
      return req('GET', '/tabs');
    case 'activate':
      return req('POST', `/tabs/${encodeURIComponent(a)}/activate`);
    case 'eval':
      return req('POST', `/tabs/${encodeURIComponent(a)}/eval`, { script: b });
    case 'pointer':
      return req('POST', `/tabs/${encodeURIComponent(a)}/pointer`, { script: b });
    case 'insert':
      return req('POST', `/tabs/${encodeURIComponent(a)}/insert`, { text: b });
    case 'snapshot':
      return req('GET', `/tabs/${encodeURIComponent(a)}/snapshot`);
    case 'autofill':
      return req('POST', `/tabs/${encodeURIComponent(a)}/autofill`);
    case 'all':
      return req('POST', `/tabs/${encodeURIComponent(a)}/all`);
    case 'essays':
      return req('POST', `/tabs/${encodeURIComponent(a)}/essays`, b ? { instruction: b } : undefined);
    case 'llm':
      return req('GET', `/tabs/${encodeURIComponent(a)}/llm`);
    case 'upload-resume':
      return req('POST', `/tabs/${encodeURIComponent(a)}/upload-resume`);
    case 'jd':
      return req('GET', `/tabs/${encodeURIComponent(a)}/jd`);
    case 'verify':
      return req('POST', '/knowledge/learn', { label: a || opt('--label'), value: b || opt('--value'), host: opt('--host') });
    case 'learn':
      return req('POST', '/knowledge/learn', {
        label: a || opt('--label'),
        selector: b || opt('--selector'),
        host: opt('--host'),
        value: opt('--value'),
        profile_key: opt('--profile-key'),
      });
    case 'ingest':
      return req('POST', '/ingest/intent', { message: a });
    case 'mail-connect':
      return req('POST', '/mail/connect');
    case 'mail-scan':
      return req('POST', '/mail/scan');
    case 'mail-code':
      return req('POST', '/mail/verification-code', {
        company: opt('--company') || a || '',
        since: opt('--since') || '',
      });
    case 'mail-resolve':
      return req('POST', '/mail/resolve', { id: a, action: b });
    case 'answers':
      return req('GET', '/profile');
    case 'harvest':
    case 'harvest-answers': {
      if (a && !String(a).startsWith('--') && !opt('--url')) {
        return req('POST', `/tabs/${encodeURIComponent(a)}/harvest-answers`);
      }
      return req('POST', '/harvest-answers', {
        url: opt('--url') || a || '',
        company: opt('--company') || '',
      });
    }
    case 'essay-log': {
      const qs = new URLSearchParams();
      if (opt('--q') || a) qs.set('q', opt('--q') || a);
      if (opt('--company')) qs.set('company', opt('--company'));
      if (opt('--sort')) qs.set('sort', opt('--sort'));
      if (opt('--limit')) qs.set('limit', opt('--limit'));
      if (opt('--min')) qs.set('min', opt('--min'));
      if (flag('--all')) qs.set('unique', '0');
      if (flag('--answers') || flag('--all-answers')) qs.set('all', '1');
      return req('GET', `/essay-log?${qs}`);
    }
    default:
      console.log(`node agent-ctl.js tabs|activate|eval|snapshot|autofill|all|essays|essay-log|harvest|llm|upload-resume|jd|verify|learn|ingest|mail-connect|mail-scan|mail-code|mail-resolve`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
