function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function compactSeparators(items) {
  const out = [];
  for (const item of items) {
    if (item.type === 'separator' && (!out.length || out[out.length - 1].type === 'separator')) continue;
    out.push(item);
  }
  if (out.length && out[out.length - 1].type === 'separator') out.pop();
  return out;
}

function buildContextMenuTemplate(params, page = {}) {
  const flags = (params && params.editFlags) || {};
  const items = [];
  const suggestions = (params && params.dictionarySuggestions) || [];
  if (params && params.misspelledWord) {
    for (const word of suggestions) {
      items.push({ label: word, action: 'replace-misspelling', word });
    }
    items.push({ label: 'Add to Dictionary', action: 'add-to-dictionary', word: params.misspelledWord });
    items.push({ type: 'separator' });
  }

  if (params && (params.isEditable || flags.canCut)) {
    items.push({ role: 'cut', enabled: Boolean(flags.canCut) });
  }
  items.push({ role: 'copy', enabled: Boolean(flags.canCopy) });
  if (params && (params.isEditable || flags.canPaste)) {
    items.push({ role: 'paste', enabled: Boolean(flags.canPaste) });
  }
  items.push({ role: 'selectAll', enabled: flags.canSelectAll !== false });

  const link = params && params.linkURL;
  if (isHttpUrl(link)) {
    items.push({ type: 'separator' });
    items.push({ label: 'Open Link', action: 'open-link', url: link });
    items.push({ label: 'Copy Link', action: 'copy-link', url: link });
  }

  if (params && (params.hasImageContents || params.mediaType === 'image')) {
    items.push({ type: 'separator' });
    items.push({ label: 'Copy Image', action: 'copy-image' });
    if (isHttpUrl(params.srcURL)) {
      items.push({ label: 'Copy Image Address', action: 'copy-link', url: params.srcURL });
    }
  }

  if (page.isWeb) {
    items.push({ type: 'separator' });
    items.push({ label: 'Back', action: 'back', enabled: Boolean(page.canGoBack) });
    items.push({ label: 'Forward', action: 'forward', enabled: Boolean(page.canGoForward) });
    items.push({ role: 'reload' });
    items.push({ label: 'Copy Page URL', action: 'copy-page-url' });
  }

  items.push({ type: 'separator' });
  items.push({ label: 'Inspect Element', action: 'inspect' });
  return compactSeparators(items);
}

function runMenuAction(action, item, wc, params, deps) {
  if (!wc || (wc.isDestroyed && wc.isDestroyed())) return;
  if (action === 'replace-misspelling' && item.word) wc.replaceMisspelling(item.word);
  if (action === 'add-to-dictionary' && item.word && wc.session) {
    wc.session.addWordToSpellCheckerDictionary(item.word);
  }
  if (action === 'open-link' && isHttpUrl(item.url)) {
    const here = wc.getURL && wc.getURL();
    if (isHttpUrl(here) && wc.loadURL) wc.loadURL(item.url);
    else if (deps.shell && deps.shell.openExternal) deps.shell.openExternal(item.url);
  }
  if (action === 'copy-link' && item.url && deps.clipboard) deps.clipboard.writeText(item.url);
  if (action === 'copy-page-url' && deps.clipboard && wc.getURL) deps.clipboard.writeText(wc.getURL() || '');
  if (action === 'copy-image' && wc.copyImageAt) wc.copyImageAt(params.x, params.y);
  if (action === 'back' && wc.canGoBack && wc.canGoBack()) wc.goBack();
  if (action === 'forward' && wc.canGoForward && wc.canGoForward()) wc.goForward();
  if (action === 'inspect' && wc.inspectElement) wc.inspectElement(params.x, params.y);
}

function hydrateMenuItem(item, wc, params, deps) {
  if (item.type === 'separator') return { type: 'separator' };
  if (item.role) return { role: item.role, enabled: item.enabled !== false };
  return {
    label: item.label,
    enabled: item.enabled !== false,
    click: () => runMenuAction(item.action, item, wc, params, deps),
  };
}

function attachContextMenu(wc, deps) {
  if (!wc || wc.__magnetContextMenu || !deps || !deps.Menu) return;
  wc.__magnetContextMenu = true;
  wc.on('context-menu', (_event, params) => {
    if (wc.isDestroyed && wc.isDestroyed()) return;
    let url = '';
    try {
      url = wc.getURL() || '';
    } catch (_) {}
    const template = buildContextMenuTemplate(params || {}, {
      isWeb: isHttpUrl(url),
      canGoBack: Boolean(wc.canGoBack && wc.canGoBack()),
      canGoForward: Boolean(wc.canGoForward && wc.canGoForward()),
    }).map((item) => hydrateMenuItem(item, wc, params || {}, deps));
    if (!template.length) return;
    const menu = deps.Menu.buildFromTemplate(template);
    const win = deps.getWindow ? deps.getWindow(wc) : null;
    menu.popup(win ? { window: win } : {});
  });
}

module.exports = {
  isHttpUrl,
  buildContextMenuTemplate,
  runMenuAction,
  attachContextMenu,
};
