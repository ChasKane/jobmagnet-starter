/** Aho-Corasick over normalized question text. Longest hit wins. */

function makeNode() {
  return { next: Object.create(null), fail: null, out: [] };
}

function build(entries) {
  const list = (entries || [])
    .map((e, i) => {
      const needle = String((e && e.needle) || '').trim();
      if (!needle) return null;
      return { needle, payload: e.payload, index: i, length: needle.length };
    })
    .filter(Boolean);
  const root = makeNode();
  root.fail = root;
  list.forEach((entry, i) => {
    let n = root;
    for (const ch of entry.needle) {
      if (!n.next[ch]) n.next[ch] = makeNode();
      n = n.next[ch];
    }
    n.out.push(i);
    entry.index = i;
  });
  const q = [];
  for (const ch of Object.keys(root.next)) {
    root.next[ch].fail = root;
    q.push(root.next[ch]);
  }
  while (q.length) {
    const cur = q.shift();
    for (const ch of Object.keys(cur.next)) {
      const child = cur.next[ch];
      q.push(child);
      let f = cur.fail;
      while (f !== root && !f.next[ch]) f = f.fail;
      child.fail = f.next[ch] || root;
      if (child.fail === child) child.fail = root;
      child.out = child.out.concat(child.fail.out);
    }
  }
  return { root, list };
}

function search(text, auto) {
  const hay = String(text || '');
  if (!auto || !auto.root || !hay) return [];
  let n = auto.root;
  const hits = [];
  for (let i = 0; i < hay.length; i++) {
    const ch = hay[i];
    while (n !== auto.root && !n.next[ch]) n = n.fail;
    n = n.next[ch] || auto.root;
    for (const idx of n.out) {
      const entry = auto.list[idx];
      hits.push({
        start: i - entry.length + 1,
        end: i,
        length: entry.length,
        needle: entry.needle,
        payload: entry.payload,
        index: entry.index,
      });
    }
  }
  return hits;
}

function longest(text, auto) {
  const hits = search(text, auto);
  if (!hits.length) return { hit: null, tie: false, hits };
  hits.sort((a, b) => b.length - a.length || a.index - b.index);
  const top = hits[0];
  const same = hits.filter((h) => h.length === top.length && h.start === top.start);
  const ids = new Set(same.map((h) => classIdOf(h.payload)));
  const tie = ids.size > 1;
  return { hit: tie ? null : top, tie, hits: same };
}

function classIdOf(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  return String(payload.id || payload.class || '');
}

module.exports = { build, search, longest, classIdOf };
