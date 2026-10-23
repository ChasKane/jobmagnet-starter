const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { buildContextMenuTemplate, runMenuAction, attachContextMenu, isHttpUrl } = require('./context-menu');

function labels(items) {
  return items.map((item) => (item.type === 'separator' ? '|' : item.role || item.label));
}

test('http urls only', () => {
  assert.equal(isHttpUrl('https://boards.greenhouse.io/x'), true);
  assert.equal(isHttpUrl('file:///tmp/index.html'), false);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
});

test('chrome/sidebar always get edit + inspect', () => {
  const items = buildContextMenuTemplate({ editFlags: { canCopy: false, canSelectAll: true } });
  assert.deepEqual(labels(items), ['copy', 'selectAll', '|', 'Inspect Element']);
});

test('editable field exposes cut/copy/paste', () => {
  const items = buildContextMenuTemplate({
    isEditable: true,
    editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
  });
  assert.deepEqual(labels(items), ['cut', 'copy', 'paste', 'selectAll', '|', 'Inspect Element']);
  assert.equal(items[0].enabled, true);
});

test('disabled edit flags stay in the menu but grayed', () => {
  const items = buildContextMenuTemplate({
    isEditable: true,
    editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false },
  });
  assert.equal(items.find((i) => i.role === 'cut').enabled, false);
  assert.equal(items.find((i) => i.role === 'paste').enabled, false);
  assert.equal(items.find((i) => i.role === 'selectAll').enabled, false);
});

test('links and web pages add nav actions', () => {
  const items = buildContextMenuTemplate(
    {
      linkURL: 'https://jobs.ashbyhq.com/acme',
      editFlags: { canCopy: true },
    },
    { isWeb: true, canGoBack: true, canGoForward: false }
  );
  assert.deepEqual(labels(items), [
    'copy',
    'selectAll',
    '|',
    'Open Link',
    'Copy Link',
    '|',
    'Back',
    'Forward',
    'reload',
    'Copy Page URL',
    '|',
    'Inspect Element',
  ]);
  assert.equal(items.find((i) => i.label === 'Back').enabled, true);
  assert.equal(items.find((i) => i.label === 'Forward').enabled, false);
});

test('javascript links are ignored', () => {
  const items = buildContextMenuTemplate({ linkURL: 'javascript:void(0)', editFlags: {} });
  assert.ok(!items.some((i) => i.action === 'open-link'));
});

test('spellcheck suggestions sit above edit roles', () => {
  const items = buildContextMenuTemplate({
    misspelledWord: 'teh',
    dictionarySuggestions: ['the'],
    isEditable: true,
    editFlags: { canCopy: true, canPaste: true, canSelectAll: true },
  });
  assert.equal(items[0].action, 'replace-misspelling');
  assert.equal(items[0].word, 'the');
  assert.equal(items[1].action, 'add-to-dictionary');
  assert.equal(items.find((i) => i.role === 'copy').role, 'copy');
  assert.ok(items.findIndex((i) => i.role === 'copy') > items.findIndex((i) => i.action === 'add-to-dictionary'));
});

test('copy image when the target is an image', () => {
  const items = buildContextMenuTemplate({
    mediaType: 'image',
    srcURL: 'https://cdn.example/logo.png',
    editFlags: {},
  });
  assert.ok(items.some((i) => i.action === 'copy-image'));
  assert.ok(items.some((i) => i.label === 'Copy Image Address' && i.url === 'https://cdn.example/logo.png'));
});

test('runMenuAction copies, navigates, and inspects', () => {
  const calls = [];
  const wc = {
    getURL: () => 'https://boards.greenhouse.io/x',
    loadURL: (url) => calls.push(['load', url]),
    replaceMisspelling: (word) => calls.push(['fix', word]),
    canGoBack: () => true,
    goBack: () => calls.push(['back']),
    inspectElement: (x, y) => calls.push(['inspect', x, y]),
    copyImageAt: (x, y) => calls.push(['image', x, y]),
    session: { addWordToSpellCheckerDictionary: (word) => calls.push(['dict', word]) },
  };
  const clip = { writeText: (text) => calls.push(['clip', text]) };
  runMenuAction('replace-misspelling', { word: 'the' }, wc, {}, {});
  runMenuAction('add-to-dictionary', { word: 'teh' }, wc, {}, {});
  runMenuAction('open-link', { url: 'https://example.com/role' }, wc, {}, {});
  runMenuAction('copy-page-url', {}, wc, {}, { clipboard: clip });
  runMenuAction('back', {}, wc, {}, {});
  runMenuAction('inspect', {}, wc, { x: 12, y: 34 }, {});
  runMenuAction('copy-image', {}, wc, { x: 2, y: 3 }, {});
  assert.deepEqual(calls, [
    ['fix', 'the'],
    ['dict', 'teh'],
    ['load', 'https://example.com/role'],
    ['clip', 'https://boards.greenhouse.io/x'],
    ['back'],
    ['inspect', 12, 34],
    ['image', 2, 3],
  ]);
});

test('open-link uses the system browser from chrome views', () => {
  const opened = [];
  runMenuAction(
    'open-link',
    { url: 'https://example.com' },
    { getURL: () => 'file:///chrome/index.html' },
    {},
    { shell: { openExternal: (url) => opened.push(url) } }
  );
  assert.deepEqual(opened, ['https://example.com']);
});

test('attachContextMenu pops a template on right-click', () => {
  const wc = new EventEmitter();
  wc.getURL = () => 'https://jobs.lever.co/x';
  wc.canGoBack = () => false;
  wc.canGoForward = () => false;
  const popped = [];
  attachContextMenu(wc, {
    Menu: {
      buildFromTemplate: (template) => ({
        popup: (opts) => popped.push({ template, opts }),
      }),
    },
    getWindow: () => ({ id: 1 }),
  });
  wc.emit('context-menu', {}, { x: 8, y: 9, editFlags: { canCopy: true } });
  assert.equal(popped.length, 1);
  assert.equal(popped[0].opts.window.id, 1);
  assert.ok(popped[0].template.some((item) => item.role === 'copy'));
  assert.ok(popped[0].template.some((item) => item.label === 'Inspect Element'));
});
