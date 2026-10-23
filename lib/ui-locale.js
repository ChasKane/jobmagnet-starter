const DEFAULT_ID = 'en-US';

const LANGUAGES = [
  {
    id: 'en-US',
    label: 'English',
    accept: 'en-US,en;q=0.9',
    hl: 'en',
    chromium: 'en-US',
    linkedinLocale: 'en_US',
    linkedinLang: 'en-us',
  },
  {
    id: 'es',
    label: 'Spanish',
    accept: 'es,es-ES;q=0.9,en;q=0.8',
    hl: 'es',
    chromium: 'es',
    linkedinLocale: 'es_ES',
    linkedinLang: 'es-es',
  },
  {
    id: 'fr',
    label: 'French',
    accept: 'fr,fr-FR;q=0.9,en;q=0.8',
    hl: 'fr',
    chromium: 'fr',
    linkedinLocale: 'fr_FR',
    linkedinLang: 'fr-fr',
  },
  {
    id: 'de',
    label: 'German',
    accept: 'de,de-DE;q=0.9,en;q=0.8',
    hl: 'de',
    chromium: 'de',
    linkedinLocale: 'de_DE',
    linkedinLang: 'de-de',
  },
  {
    id: 'pt-BR',
    label: 'Portuguese',
    accept: 'pt-BR,pt;q=0.9,en;q=0.8',
    hl: 'pt-BR',
    chromium: 'pt-BR',
    linkedinLocale: 'pt_BR',
    linkedinLang: 'pt-br',
  },
  {
    id: 'ja',
    label: 'Japanese',
    accept: 'ja,ja-JP;q=0.9,en;q=0.8',
    hl: 'ja',
    chromium: 'ja',
    linkedinLocale: 'ja_JP',
    linkedinLang: 'ja-jp',
  },
  {
    id: 'zh-CN',
    label: 'Chinese',
    accept: 'zh-CN,zh;q=0.9,en;q=0.8',
    hl: 'zh-CN',
    chromium: 'zh-CN',
    linkedinLocale: 'zh_CN',
    linkedinLang: 'zh-cn',
  },
];

const BY_ID = new Map(LANGUAGES.map((row) => [row.id, row]));

/** LinkedIn locale path prefixes. Never include `in` — that is /in/ profiles. */
const LINKEDIN_PATH_PREFIXES = new Set([
  'es',
  'fr',
  'de',
  'pt',
  'jp',
  'ja',
  'zh',
  'cn',
  'it',
  'nl',
  'pl',
  'ru',
  'ko',
  'tr',
  'sv',
  'da',
  'no',
  'fi',
  'cs',
  'ro',
  'hu',
  'ar',
  'id',
  'th',
  'vi',
  'uk',
  'ms',
  'he',
]);

function asUiLanguage(value) {
  const id = String(value || '').trim();
  return BY_ID.has(id) ? id : DEFAULT_ID;
}

function languageOf(value) {
  return BY_ID.get(asUiLanguage(value));
}

function acceptLanguageHeader(value) {
  return languageOf(value).accept;
}

function chromiumLang(value) {
  return languageOf(value).chromium;
}

function fieldOptions() {
  return LANGUAGES.map((row) => ({ value: row.id, label: row.label }));
}

function linkedinLangCookie(value) {
  const lang = languageOf(value);
  return {
    lang: `v=2&lang=${lang.linkedinLang}`,
    li_lang: lang.linkedinLocale,
  };
}

function isLinkedInHost(hostname) {
  return /(^|\.)linkedin\.com$/i.test(String(hostname || ''));
}

function rewriteLinkedInHost(hostname) {
  const host = String(hostname || '');
  const m = host.match(/^([a-z]{2})\.linkedin\.com$/i);
  if (m && LINKEDIN_PATH_PREFIXES.has(m[1].toLowerCase())) return 'www.linkedin.com';
  return host;
}

function stripLinkedInPathPrefix(pathname) {
  const raw = String(pathname || '/');
  const trailing = raw.length > 1 && raw.endsWith('/');
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] && LINKEDIN_PATH_PREFIXES.has(parts[0].toLowerCase())) parts.shift();
  const next = '/' + parts.join('/');
  if (trailing && next !== '/') return next + '/';
  return next;
}

function withUiLocale(url, value) {
  try {
    const u = new URL(url);
    const lang = languageOf(value);
    if (isLinkedInHost(u.hostname)) {
      if (/\/safety\//i.test(u.pathname) || u.searchParams.has('urlhash')) return url;
      u.hostname = rewriteLinkedInHost(u.hostname);
      u.pathname = stripLinkedInPathPrefix(u.pathname);
      u.searchParams.set('locale', lang.linkedinLocale);
      return u.toString();
    }
    if (u.searchParams.has('hl')) u.searchParams.set('hl', lang.hl);
    if (u.searchParams.has('lang')) u.searchParams.set('lang', lang.hl);
    if (u.searchParams.has('locale')) u.searchParams.set('locale', lang.linkedinLocale);
    return u.toString();
  } catch {
    return url;
  }
}

function pageSource(url, value) {
  return {
    uri: withUiLocale(url, value),
    headers: { 'Accept-Language': acceptLanguageHeader(value) },
  };
}

module.exports = {
  DEFAULT_ID,
  LANGUAGES,
  asUiLanguage,
  languageOf,
  acceptLanguageHeader,
  chromiumLang,
  fieldOptions,
  linkedinLangCookie,
  withUiLocale,
  pageSource,
};
