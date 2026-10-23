/** Detect a sign-in / auth wall from the current page. Never reads cookies. */

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function pathOf(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function siteOf(host) {
  if (/linkedin\.com$/.test(host)) return 'linkedin';
  if (/workatastartup\.com$/.test(host) || /ycombinator\.com$/.test(host)) return 'ycombinator';
  if (/wellfound\.com$/.test(host) || /angel\.co$/.test(host)) return 'wellfound';
  if (/greenhouse\.io$/.test(host)) return 'greenhouse';
  if (/lever\.co$/.test(host)) return 'lever';
  if (/ashbyhq\.com$/.test(host)) return 'ashby';
  if (/indeed\.com$/.test(host)) return 'indeed';
  return host.split('.')[0] || host || 'site';
}

function loginWall({ url = '', title = '', text = '' } = {}) {
  const href = String(url || '');
  const host = hostOf(href);
  const path = pathOf(href);
  const blob = `${title || ''}\n${text || ''}`.slice(0, 4000);
  const site = siteOf(host);

  const pathHit =
    /\/(login|log-in|sign[-_]?in|uas\/login|checkpoint|authwall|signup|users\/sign_in|session\/new)/i.test(path) ||
    /[?&](session_redirect|authwall|trk=guest)/i.test(href) ||
    /\/authwall/i.test(href);

  const gatedText =
    /sign in to (view|see|continue|apply|unlock)/i.test(blob) ||
    /join linkedin to/i.test(blob) ||
    /you.?re signed out/i.test(blob) ||
    /create an? account to (view|see|continue)/i.test(blob) ||
    (/password/i.test(blob) && /sign in/i.test(blob) && /(email|phone|forgot)/i.test(blob));

  return {
    login: Boolean(pathHit || gatedText),
    site,
    url: href,
  };
}

function loginPrompt(wall) {
  const site = (wall && wall.site) || 'this site';
  const label =
    site === 'linkedin'
      ? 'LinkedIn'
      : site === 'ycombinator'
        ? 'Work at a Startup'
        : site.charAt(0).toUpperCase() + site.slice(1);
  return `${label} needs a sign-in. Magnet will show the login page — cookies stay on this machine. Never paste a password here.`;
}

module.exports = { hostOf, siteOf, loginWall, loginPrompt };
