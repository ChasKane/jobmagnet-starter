const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MAGNET_SETTINGS = path.join(os.tmpdir(), `magnet-settings-${process.pid}.yaml`);

const settings = require('./settings');

test('defaults keep chat sound on and context-dependent Ctrl+Tab off', () => {
  assert.equal(settings.normalize({}).chatSound, true);
  assert.equal(settings.normalize({}).contextCtrlTab, false);
  assert.equal(settings.normalize({}).modelId, 'grok-4.6');
  assert.deepEqual(settings.normalize({}).modelParams, { fast: 'true' });
  assert.deepEqual(settings.normalize({}).customModels, []);
  assert.equal(settings.normalize({}).handedness, 'right');
  assert.equal(settings.normalize({ handedness: 'left' }).handedness, 'left');
  assert.equal(settings.normalize({}).uiLanguage, 'en-US');
  assert.equal(settings.normalize({ uiLanguage: 'es' }).uiLanguage, 'es');
  assert.equal(settings.normalize({ uiLanguage: 'nope' }).uiLanguage, 'en-US');
  assert.equal(settings.normalize({}).sidebarWidth, 260);
  assert.equal(settings.normalize({}).drawerWidth, 420);
  assert.deepEqual(settings.normalize({}).sidebarFilters, {
    status: 'open',
    yoe: 'all',
    level: 'all',
    q: '',
    sort: 'updated',
  });
  assert.equal(settings.ctrlTabTarget({}, true), 'chat');
  assert.equal(settings.ctrlTabTarget({}, false), 'chat');
});

test('context-dependent Ctrl+Tab cycles jobs only when chat is not focused', () => {
  assert.equal(settings.ctrlTabTarget({ contextCtrlTab: true }, true), 'chat');
  assert.equal(settings.ctrlTabTarget({ contextCtrlTab: true }, false), 'job');
});

test('save and load round-trip through yaml', () => {
  try {
    fs.unlinkSync(settings.settingsFile());
  } catch (_) {}
  assert.equal(settings.load().chatSound, true);
  assert.equal(settings.load().contextCtrlTab, false);
  const saved = settings.save({ chatSound: false, contextCtrlTab: true });
  assert.equal(saved.chatSound, false);
  assert.equal(saved.contextCtrlTab, true);
  assert.equal(settings.load().chatSound, false);
  assert.equal(settings.load().contextCtrlTab, true);
  const withModel = settings.save({ modelId: 'composer-2.5', modelParams: { fast: 'false' }, customModels: ['my-model'] });
  assert.equal(withModel.modelId, 'composer-2.5');
  assert.deepEqual(withModel.modelParams, { fast: 'false' });
  assert.deepEqual(withModel.customModels, ['my-model']);
  const withHand = settings.save({ handedness: 'left' });
  assert.equal(withHand.handedness, 'left');
  const withLang = settings.save({ uiLanguage: 'es' });
  assert.equal(withLang.uiLanguage, 'es');
  assert.equal(settings.load().uiLanguage, 'es');
  const withPanels = settings.save({ sidebarWidth: 300, drawerWidth: 500 });
  assert.equal(withPanels.sidebarWidth, 300);
  assert.equal(withPanels.drawerWidth, 500);
  assert.equal(settings.load().sidebarWidth, 300);
  const withFilters = settings.save({
    sidebarFilters: { status: 'passed', yoe: '5+', level: 'senior', q: 'cedar', sort: 'salary' },
  });
  assert.deepEqual(withFilters.sidebarFilters, {
    status: 'passed',
    yoe: '5+',
    level: 'senior',
    q: 'cedar',
    sort: 'salary',
  });
  assert.deepEqual(settings.load().sidebarFilters, withFilters.sidebarFilters);
  const snap = settings.snapshot();
  assert.equal(snap.settings.chatSound, false);
  assert.equal(snap.settings.contextCtrlTab, true);
  const chatSound = snap.fields.find((field) => field.key === 'chatSound');
  const contextCtrlTab = snap.fields.find((field) => field.key === 'contextCtrlTab');
  assert.equal(chatSound.value, false);
  const handedness = snap.fields.find((field) => field.key === 'handedness');
  assert.equal(handedness.type, 'select');
  assert.equal(handedness.value, 'left');
  const uiLanguage = snap.fields.find((field) => field.key === 'uiLanguage');
  assert.equal(uiLanguage.type, 'select');
  assert.equal(uiLanguage.value, 'es');
  assert.ok(uiLanguage.options.some((opt) => opt.value === 'en-US'));
  fs.unlinkSync(settings.settingsFile());
});

test('snapshot lists typical Gmail actions', () => {
  const signedOut = settings.snapshot({});
  assert.deepEqual(
    signedOut.actions.map((action) => action.key),
    ['gmailConnect', 'gmailScan', 'gmailSignOut', 'resumeImport', 'exportBundle', 'importBundle', 'essayLog']
  );
  assert.equal(signedOut.actions.find((a) => a.key === 'gmailConnect').available, true);
  assert.equal(signedOut.actions.find((a) => a.key === 'gmailScan').available, true);
  assert.equal(signedOut.actions.find((a) => a.key === 'gmailSignOut').available, false);

  const signedIn = settings.snapshot({}, { mail: { connected: true, email: 'chas@example.com', pending: [{ id: '1' }] } });
  assert.equal(signedIn.mail.email, 'chas@example.com');
  assert.equal(signedIn.mail.pending, 1);
  assert.equal(signedIn.actions.find((a) => a.key === 'gmailConnect').available, false);
  assert.equal(signedIn.actions.find((a) => a.key === 'gmailSignOut').available, true);
});
