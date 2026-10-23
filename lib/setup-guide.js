const fs = require('fs');
const path = require('path');

const STORY_GOAL = 3;

function repoRoot() {
  return path.join(__dirname, '..');
}

function controlPort(status) {
  const n = Number((status && status.port) || process.env.MAGNET_PORT || 3872);
  return Number.isFinite(n) && n > 0 ? n : 3872;
}

function redirectUri(status) {
  return `http://127.0.0.1:${controlPort(status)}/mail/oauth/callback`;
}

function nextStep(status) {
  const s = status || {};
  if (!s.apiKey) return 'apiKey';
  if (!s.gmailClientId || !s.gmailClientSecret) return 'gmailClient';
  if (!s.gmailConnected) return 'gmailConnect';
  if (!s.resumeCount) return 'resume';
  if (!s.storiesDone && Number(s.storyCount) < STORY_GOAL) return 'stories';
  return null;
}

function incomplete(status) {
  return Boolean(nextStep(status));
}

function flagsPath(root) {
  return path.join(root || repoRoot(), 'knowledge', 'setup.json');
}

function readFlags(root) {
  try {
    const doc = JSON.parse(fs.readFileSync(flagsPath(root), 'utf8'));
    return { storiesDone: Boolean(doc && doc.storiesDone) };
  } catch {
    return { storiesDone: false };
  }
}

function markStoriesDone(root) {
  const file = flagsPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    prev = {};
  }
  fs.writeFileSync(file, JSON.stringify({ ...prev, storiesDone: true }, null, 2));
}

function envPath(root) {
  return path.join(root || repoRoot(), '.env');
}

function envAssignment(key, value) {
  const v = String(value == null ? '' : value).replace(/\r?\n/g, '').trim();
  if (/^[A-Za-z0-9_\-.]+$/.test(v)) return `${key}=${v}`;
  return `${key}=${JSON.stringify(v)}`;
}

function writeEnv(updates, root) {
  const file = envPath(root);
  const keys = Object.keys(updates || {}).filter((k) => updates[k] != null && String(updates[k]).trim());
  if (!keys.length) return;
  let lines = [];
  try {
    if (fs.existsSync(file)) lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    lines = [];
  }
  const seen = new Set();
  const next = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && keys.includes(m[1])) {
      next.push(envAssignment(m[1], updates[m[1]]));
      seen.add(m[1]);
    } else if (line.trim() || next.length) {
      next.push(line);
    }
  }
  for (const key of keys) {
    if (seen.has(key)) continue;
    next.push(envAssignment(key, updates[key]));
  }
  fs.writeFileSync(file, `${next.join('\n').replace(/\n+$/, '')}\n`);
  for (const key of keys) process.env[key] = String(updates[key]).trim();
}

function answerBody(text) {
  const raw = String(text || '').trim();
  const arrow = raw.lastIndexOf('→');
  if (arrow >= 0) return raw.slice(arrow + 1).trim();
  return raw;
}

function tokens(text) {
  return String(text || '')
    .split(/[\s,]+/)
    .map((part) => part.replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

function looksLikeApiKey(token) {
  if (!token || token.length < 20) return false;
  if (!/^[A-Za-z0-9_\-.]+$/.test(token)) return false;
  if (/googleusercontent|\.pdf$|GOCSPX-/i.test(token)) return false;
  return true;
}

function apiKeyFrom(text) {
  const found = tokens(text).filter(looksLikeApiKey).sort((a, b) => b.length - a.length);
  return found[0] || '';
}

function gmailCredsFrom(text) {
  const raw = String(text || '');
  const id = (raw.match(/[A-Za-z0-9-]+\.apps\.googleusercontent\.com/i) || [])[0] || '';
  let secret = (raw.match(/GOCSPX-[A-Za-z0-9_-]+/) || [])[0] || '';
  if (!secret) {
    const labeled = raw.match(/secret\s*[:=]\s*(\S+)/i);
    if (labeled) secret = labeled[1].replace(/^['"]|['"]$/g, '');
  }
  return { id, secret };
}

function wantsConnect(text) {
  const body = answerBody(text);
  return /\b(connect|sign[\s-]?in)\b/i.test(body);
}

function wantsResume(text) {
  const body = answerBody(text);
  return /\b(upload|import|choose|attach|resume|pdf|docx)\b/i.test(body);
}

function wantsDone(text) {
  const body = answerBody(text);
  return /^(done|that'?s enough|enough|skip|move on|later|stop)\b/i.test(body);
}

function parseStory(text) {
  const body = answerBody(text);
  if (!body || wantsDone(body)) return null;
  let match = body.match(/^(?:at|@)\s+(.{2,80}?)\s+i\s+([\s\S]+)/i);
  if (match) {
    const employer = match[1].replace(/[:,\s]+$/g, '').trim();
    const story = body.trim();
    if (employer && story.length >= 12) return { employer, text: story };
  }
  match = body.match(/^employer\s*:\s*(.+)\n+([\s\S]+)/i);
  if (match && match[2].trim().length >= 12) {
    return { employer: match[1].trim(), text: body.trim() };
  }
  match = body.match(/^([^:\n]{2,60}):\s+([\s\S]+)/);
  if (match && match[2].trim().length >= 12 && !/client|secret|gmail|oauth|api/i.test(match[1])) {
    return { employer: match[1].trim(), text: body.trim() };
  }
  return null;
}

function interpret(text, status) {
  const step = nextStep(status);
  const raw = String(text || '');
  if (!step) return {};
  if (step === 'apiKey') {
    if (/GOCSPX-|googleusercontent/i.test(raw)) {
      return { note: 'That looks like a Google OAuth value. Paste the Cursor API key first. Gmail is the next step.' };
    }
    const key = apiKeyFrom(raw);
    if (!key) {
      return { note: 'Paste the Cursor API key by itself. It is the long token from Cursor Settings → Models.' };
    }
    return { env: { CURSOR_API_KEY: key }, note: 'Saved the Cursor API key in this folder’s .env.' };
  }
  if (step === 'gmailClient') {
    const creds = gmailCredsFrom(raw);
    const env = {};
    if (creds.id) env.GMAIL_CLIENT_ID = creds.id;
    if (creds.secret) env.GMAIL_CLIENT_SECRET = creds.secret;
    if (!creds.id && !creds.secret) {
      return {
        note: `Paste the OAuth client id (it ends in .apps.googleusercontent.com) and the client secret. Redirect URI: ${redirectUri(status)}`,
      };
    }
    const notes = ['Saved the Google OAuth value in .env.'];
    if (!creds.id && !(status && status.gmailClientId)) notes.push('Still need the client id.');
    if (!creds.secret && !(status && status.gmailClientSecret)) notes.push('Still need the client secret.');
    return { env, note: notes.join(' ') };
  }
  if (step === 'gmailConnect') {
    if (!wantsConnect(raw)) {
      return { note: 'Say “connect Gmail” when you are ready to sign in, or press Connect Gmail.' };
    }
    return { needConnect: true };
  }
  if (step === 'resume') {
    if (!wantsResume(raw)) {
      return { note: 'Say “upload resume” or press Choose resume file. PDF or Word.' };
    }
    return { needResume: true };
  }
  if (wantsDone(raw)) {
    if (Number(status && status.storyCount) < 1) {
      return { note: 'File one story first. Three is the batch. One is enough if you want to stop after that.' };
    }
    return { storiesDone: true, note: `Stopping at ${status.storyCount} stor${status.storyCount === 1 ? 'y' : 'ies'}.` };
  }
  const story = parseStory(raw);
  if (!story) {
    return {
      note: 'Start with the employer, then what you did. Example: At Northwind I shipped the checkout rewrite and owned the empty states. I did not own the pricing experiment.',
    };
  }
  return { fileStory: story };
}

function ask(id, prompt, extra) {
  return {
    id,
    prompt,
    answered: false,
    allow_multiple: false,
    ...extra,
  };
}

function render(status, opts) {
  const step = nextStep(status);
  const intro = Boolean(opts && opts.intro);
  if (!step) {
    return {
      reply:
        'Setup is done. Describe a search — sites, how recent, keywords, pay — or paste apply URLs. Magnet drafts a plan. You hit Go.',
      asks: [],
    };
  }
  if (step === 'apiKey') {
    const lead = intro
      ? 'This copy starts empty. Ingest will walk you through four steps: a Cursor API key, Gmail, a resume, and three story cards. After that, search works the same way it does in a filled-in install.\n\n'
      : '';
    return {
      reply: `${lead}First, a Cursor API key. In Cursor, open Settings, then Models, and create an API key. Paste it here. Magnet stores it in this folder’s .env and uses it for search plans and essays.`,
      asks: [ask('setup-api-key', 'Paste your Cursor API key')],
    };
  }
  if (step === 'gmailClient') {
    const haveId = Boolean(status && status.gmailClientId);
    const haveSecret = Boolean(status && status.gmailClientSecret);
    const missing = !haveId && !haveSecret ? 'the client id and the client secret' : !haveId ? 'the client id' : 'the client secret';
    return {
      reply: `Next, Gmail. Create a Google Cloud OAuth client (type Desktop) with the Gmail API enabled. While the consent screen is in testing, add the Gmail account as a test user. If Google asks for a redirect URI, use ${redirectUri(status)}. Paste ${missing}.`,
      asks: [ask('setup-gmail-client', `Paste ${missing}`)],
    };
  }
  if (step === 'gmailConnect') {
    return {
      reply: 'Google client is saved. Connect the Gmail account Magnet should read for application mail.',
      asks: [
        ask('setup-gmail-connect', 'Connect Gmail', {
          options: [{ id: 'connect', label: 'Connect Gmail' }],
        }),
      ],
    };
  }
  if (step === 'resume') {
    return {
      reply: 'Upload a resume (PDF or Word). Autofill attaches this file from the vault.',
      asks: [
        ask('setup-resume', 'Add your resume', {
          options: [{ id: 'upload', label: 'Choose resume file' }],
        }),
      ],
    };
  }
  const have = Number(status && status.storyCount) || 0;
  const left = Math.max(STORY_GOAL - have, 1);
  return {
    reply: `Last step: story cards. Essays may use only what you file here. Send ${left} more. Start with the employer, then what you built, owned, or shipped, and name anything you did not own.\n\nExample: At Northwind I shipped the checkout rewrite and owned the empty states. I did not own the pricing experiment.\n\nSay “done” after at least one if you want to stop early.`,
    asks: [ask('setup-story', 'One work story', { why: 'Employer first, then the work.' })],
  };
}

module.exports = {
  STORY_GOAL,
  nextStep,
  incomplete,
  interpret,
  render,
  readFlags,
  markStoriesDone,
  writeEnv,
  redirectUri,
  parseStory,
  apiKeyFrom,
  gmailCredsFrom,
};
