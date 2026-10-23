const DEFAULT_SIDEBAR = 260;
const DEFAULT_DRAWER = 420;
const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 560;
const MIN_DRAWER = 280;
const MAX_DRAWER = 720;
const MIN_CENTER = 280;
const SPLITTER = 6;

function clampInt(n, min, max, fallback) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function clampSidebar(n) {
  return clampInt(n, MIN_SIDEBAR, MAX_SIDEBAR, DEFAULT_SIDEBAR);
}

function clampDrawer(n) {
  return clampInt(n, MIN_DRAWER, MAX_DRAWER, DEFAULT_DRAWER);
}

function clampPanels(windowWidth, sidebar, drawer) {
  let side = clampSidebar(sidebar);
  let draw = clampDrawer(drawer);
  const avail = Math.max(0, Math.round(Number(windowWidth) || 0));
  const needed = MIN_SIDEBAR + MIN_DRAWER + MIN_CENTER;
  if (avail > 0 && avail < needed) {
    const rest = Math.max(0, avail - MIN_CENTER);
    side = Math.min(side, Math.max(MIN_SIDEBAR, Math.floor(rest / 2)));
    draw = Math.max(0, avail - MIN_CENTER - side);
    return { sidebar: side, drawer: draw, center: Math.max(0, avail - side - draw) };
  }
  if (side + draw + MIN_CENTER > avail) {
    let overflow = side + draw + MIN_CENTER - avail;
    const fromDraw = Math.min(overflow, Math.max(0, draw - MIN_DRAWER));
    draw -= fromDraw;
    overflow -= fromDraw;
    side -= Math.min(overflow, Math.max(0, side - MIN_SIDEBAR));
  }
  return { sidebar: side, drawer: draw, center: Math.max(MIN_CENTER, avail - side - draw) };
}

function applySplitDrag({ which, originX, originSidebar, originDrawer, screenX, windowWidth }) {
  const dx = Math.round(Number(screenX) || 0) - Math.round(Number(originX) || 0);
  if (which === 'drawer') return clampPanels(windowWidth, originSidebar, originDrawer - dx);
  return clampPanels(windowWidth, originSidebar + dx, originDrawer);
}

function desktopShellBounds({
  width,
  height,
  sidebarWidth,
  drawerWidth,
  chromeHeight,
  footerHeight,
}) {
  const panels = clampPanels(width, sidebarWidth, drawerWidth);
  const ch = Math.max(0, Math.round(Number(chromeHeight) || 0));
  const fh = Math.max(0, Math.round(Number(footerHeight) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const centerX = panels.sidebar;
  const webH = Math.max(100, h - ch - fh);
  return {
    panels,
    sidebar: { x: 0, y: 0, width: panels.sidebar, height: h },
    chrome: { x: centerX, y: 0, width: panels.center, height: ch },
    webview: { x: centerX, y: ch, width: panels.center, height: webH },
    footer: { x: centerX, y: Math.max(ch, h - fh), width: panels.center, height: fh },
    drawer: { x: centerX + panels.center, y: 0, width: panels.drawer, height: h },
    splitLeft: { x: Math.max(0, panels.sidebar - SPLITTER), y: 0, width: SPLITTER, height: h },
    splitRight: { x: centerX + panels.center, y: 0, width: SPLITTER, height: h },
  };
}

module.exports = {
  DEFAULT_SIDEBAR,
  DEFAULT_DRAWER,
  MIN_SIDEBAR,
  MAX_SIDEBAR,
  MIN_DRAWER,
  MAX_DRAWER,
  MIN_CENTER,
  SPLITTER,
  clampInt,
  clampSidebar,
  clampDrawer,
  clampPanels,
  applySplitDrag,
  desktopShellBounds,
};
