const { test } = require('node:test');
const assert = require('node:assert/strict');
const layout = require('./shell-layout');

test('chrome and footer stay on the middle column, drawer is full height', () => {
  const b = layout.desktopShellBounds({
    width: 1280,
    height: 860,
    sidebarWidth: 260,
    drawerWidth: 420,
    chromeHeight: 80,
    footerHeight: 52,
  });
  assert.equal(b.chrome.x, b.webview.x);
  assert.equal(b.chrome.width, b.webview.width);
  assert.equal(b.footer.x, b.webview.x);
  assert.equal(b.footer.width, b.webview.width);
  assert.equal(b.chrome.x + b.chrome.width, b.drawer.x);
  assert.equal(b.drawer.y, 0);
  assert.equal(b.drawer.height, 860);
  assert.equal(b.sidebar.height, 860);
  assert.ok(b.chrome.width < 1280 - b.sidebar.width);
  assert.equal(b.chrome.width + b.sidebar.width + b.drawer.width, 1280);
  assert.equal(b.splitLeft.x + b.splitLeft.width, b.sidebar.width);
  assert.equal(b.splitRight.x, b.drawer.x);
});

test('find-bar chrome growth does not move the drawer', () => {
  const base = layout.desktopShellBounds({
    width: 1280,
    height: 860,
    sidebarWidth: 260,
    drawerWidth: 420,
    chromeHeight: 80,
    footerHeight: 52,
  });
  const open = layout.desktopShellBounds({
    width: 1280,
    height: 860,
    sidebarWidth: 260,
    drawerWidth: 420,
    chromeHeight: 120,
    footerHeight: 52,
  });
  assert.deepEqual(open.drawer, base.drawer);
  assert.equal(open.chrome.height, 120);
  assert.equal(open.webview.y, 120);
  assert.equal(open.webview.height, base.webview.height - 40);
});

test('dragging the left edge grows the jobs panel', () => {
  const next = layout.applySplitDrag({
    which: 'sidebar',
    originX: 260,
    originSidebar: 260,
    originDrawer: 420,
    screenX: 320,
    windowWidth: 1280,
  });
  assert.equal(next.sidebar, 320);
  assert.equal(next.drawer, 420);
});

test('dragging the drawer edge left grows chat', () => {
  const next = layout.applySplitDrag({
    which: 'drawer',
    originX: 860,
    originSidebar: 260,
    originDrawer: 420,
    screenX: 800,
    windowWidth: 1280,
  });
  assert.equal(next.sidebar, 260);
  assert.equal(next.drawer, 480);
});

test('panels keep a usable center column when the window is tight', () => {
  const next = layout.clampPanels(800, 500, 500);
  assert.ok(next.center >= layout.MIN_CENTER);
  assert.equal(next.sidebar + next.drawer + next.center, 800);
});
