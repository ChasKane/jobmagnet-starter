const MAX_SHORT = 60;
const MAX_LONG = 250;

function collectHits(texts, query, max) {
  const needle = String(query || '').toLowerCase();
  const hits = [];
  if (!needle) return hits;
  const cap = Math.max(1, Number(max) || MAX_LONG);
  const len = String(query).length;
  for (let t = 0; t < texts.length; t++) {
    const lower = String(texts[t] || '').toLowerCase();
    let from = 0;
    while (hits.length < cap) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      hits.push({ textIndex: t, start: i, end: i + len });
      from = i + len;
    }
  }
  return hits;
}

function maxMatches(query) {
  return String(query || '').length < 2 ? MAX_SHORT : MAX_LONG;
}

function script(query, opts = {}) {
  return `(() => {
    const query = ${JSON.stringify(String(query || ''))};
    const opts = ${JSON.stringify({
      forward: opts.forward !== false,
      findNext: Boolean(opts.findNext),
      activate: opts.activate !== false,
    })};
    const MAX = query.length < 2 ? ${MAX_SHORT} : ${MAX_LONG};
    const STYLE_ID = 'magnet-find-css';
    const ensureStyle = () => {
      if (document.getElementById(STYLE_ID)) return;
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = '::highlight(magnet-find){background:#fde047;color:#111}::highlight(magnet-find-active){background:#fb923c;color:#111}';
      document.documentElement.appendChild(s);
    };
    const clear = () => {
      if (window.CSS && CSS.highlights) {
        CSS.highlights.delete('magnet-find');
        CSS.highlights.delete('magnet-find-active');
      }
      for (const el of document.querySelectorAll('[data-magnet-find-field]')) {
        el.removeAttribute('data-magnet-find-field');
        el.style.outline = '';
      }
      window.__magnetFind = { query: '', ranges: [], index: 0 };
    };
    const scrollTo = (range) => {
      if (!range || !opts.activate) return;
      const node = range.startContainer && range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer && range.startContainer.parentElement;
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      }
    };
    const paint = (state) => {
      const ranges = state.ranges || [];
      if (window.CSS && CSS.highlights) {
        const textRanges = ranges.filter((r) => r && r.startContainer && r.startContainer.nodeType === 3);
        const active = opts.activate ? textRanges[state.index] : null;
        const rest = textRanges.filter((r) => r !== active);
        try {
          CSS.highlights.set('magnet-find', rest.length ? new Highlight(...rest) : new Highlight());
          if (active) CSS.highlights.set('magnet-find-active', new Highlight(active));
          else CSS.highlights.delete('magnet-find-active');
        } catch (_) {}
      }
      scrollTo(ranges[state.index]);
    };
    if (!query) {
      clear();
      return { matches: 0, activeMatchOrdinal: 0, finalUpdate: true };
    }
    ensureStyle();
    const prev = window.__magnetFind || { query: '', ranges: [], index: 0 };
    if (opts.findNext && prev.query === query && prev.ranges && prev.ranges.length) {
      const dir = opts.forward === false ? -1 : 1;
      prev.index = (prev.index + dir + prev.ranges.length) % prev.ranges.length;
      paint(prev);
      window.__magnetFind = prev;
      return { matches: prev.ranges.length, activeMatchOrdinal: prev.index + 1, finalUpdate: true };
    }
    clear();
    ensureStyle();
    const ranges = [];
    const needle = query.toLowerCase();
    const root = document.body || document.documentElement;
    if (root) {
      const skip = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1 };
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p || skip[p.tagName] || !node.nodeValue) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let node;
      while ((node = tw.nextNode()) && ranges.length < MAX) {
        const lower = node.nodeValue.toLowerCase();
        let from = 0;
        while (ranges.length < MAX) {
          const i = lower.indexOf(needle, from);
          if (i < 0) break;
          const range = new Range();
          range.setStart(node, i);
          range.setEnd(node, i + query.length);
          ranges.push(range);
          from = i + query.length;
        }
      }
      for (const el of document.querySelectorAll('input, textarea, select')) {
        if (ranges.length >= MAX) break;
        const val = String(el.value || '');
        if (!val.toLowerCase().includes(needle)) continue;
        el.setAttribute('data-magnet-find-field', '1');
        el.style.outline = '2px solid #fde047';
        try {
          const range = new Range();
          range.selectNode(el);
          ranges.push(range);
        } catch (_) {}
      }
    }
    const state = { query, ranges, index: 0 };
    paint(state);
    window.__magnetFind = state;
    return {
      matches: ranges.length,
      activeMatchOrdinal: ranges.length && opts.activate ? 1 : 0,
      finalUpdate: true,
    };
  })()`;
}

module.exports = {
  MAX_SHORT,
  MAX_LONG,
  collectHits,
  maxMatches,
  script,
};
