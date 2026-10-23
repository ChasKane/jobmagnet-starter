const { test } = require('node:test');
const assert = require('node:assert/strict');
const locale = require('./ui-locale');

test('unknown language falls back to English', () => {
  assert.equal(locale.asUiLanguage(), 'en-US');
  assert.equal(locale.asUiLanguage(''), 'en-US');
  assert.equal(locale.asUiLanguage('nope'), 'en-US');
  assert.equal(locale.asUiLanguage('es'), 'es');
});

test('Accept-Language and Chromium lang map from the catalog', () => {
  assert.equal(locale.acceptLanguageHeader('en-US'), 'en-US,en;q=0.9');
  assert.equal(locale.acceptLanguageHeader('es'), 'es,es-ES;q=0.9,en;q=0.8');
  assert.equal(locale.chromiumLang('en-US'), 'en-US');
  assert.equal(locale.chromiumLang('ja'), 'ja');
});

test('LinkedIn always sets locale and overrides an existing one', () => {
  assert.equal(
    locale.withUiLocale('https://www.linkedin.com/jobs/view/4444068590/', 'en-US'),
    'https://www.linkedin.com/jobs/view/4444068590/?locale=en_US'
  );
  assert.equal(
    locale.withUiLocale('https://www.linkedin.com/jobs/view/1/?locale=es_ES', 'en-US'),
    'https://www.linkedin.com/jobs/view/1/?locale=en_US'
  );
  assert.equal(
    locale.withUiLocale('https://www.linkedin.com/jobs/view/1/?locale=en_US', 'es'),
    'https://www.linkedin.com/jobs/view/1/?locale=es_ES'
  );
});

test('LinkedIn strips localized path prefixes and language subdomains', () => {
  assert.equal(
    locale.withUiLocale('https://www.linkedin.com/es/jobs/view/1/', 'en-US'),
    'https://www.linkedin.com/jobs/view/1/?locale=en_US'
  );
  assert.equal(
    locale.withUiLocale('https://es.linkedin.com/jobs/view/1/', 'en-US'),
    'https://www.linkedin.com/jobs/view/1/?locale=en_US'
  );
});

test('LinkedIn leaves /in/ profiles and safety redirects alone', () => {
  assert.equal(
    locale.withUiLocale('https://www.linkedin.com/in/someone/', 'en-US'),
    'https://www.linkedin.com/in/someone/?locale=en_US'
  );
  assert.equal(
    locale.withUiLocale('https://www.linkedin.com/safety/go?url=https://example.com', 'en-US'),
    'https://www.linkedin.com/safety/go?url=https://example.com'
  );
  assert.equal(
    locale.withUiLocale('https://www.linkedin.com/jobs/view/1/?urlhash=abc', 'en-US'),
    'https://www.linkedin.com/jobs/view/1/?urlhash=abc'
  );
});

test('non-LinkedIn URLs stay put unless they already carry language params', () => {
  assert.equal(
    locale.withUiLocale('https://job-boards.greenhouse.io/reddit/jobs/8082867', 'en-US'),
    'https://job-boards.greenhouse.io/reddit/jobs/8082867'
  );
  assert.equal(
    locale.withUiLocale('https://boards.greenhouse.io/acme?hl=es&lang=es&locale=es_ES', 'en-US'),
    'https://boards.greenhouse.io/acme?hl=en&lang=en&locale=en_US'
  );
});

test('LinkedIn lang cookies and page source carry the chosen language', () => {
  assert.deepEqual(locale.linkedinLangCookie('en-US'), {
    lang: 'v=2&lang=en-us',
    li_lang: 'en_US',
  });
  assert.deepEqual(locale.linkedinLangCookie('es'), {
    lang: 'v=2&lang=es-es',
    li_lang: 'es_ES',
  });
  const src = locale.pageSource('https://www.linkedin.com/jobs/view/1/', 'en-US');
  assert.equal(src.uri, 'https://www.linkedin.com/jobs/view/1/?locale=en_US');
  assert.equal(src.headers['Accept-Language'], 'en-US,en;q=0.9');
});
