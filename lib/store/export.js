const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const store = require('./index');

function exportDir() {
  return process.env.MAGNET_EXPORT || path.join(__dirname, '..', '..', 'knowledge', 'export');
}

function dump() {
  store.open();
  const dest = exportDir();
  fs.mkdirSync(dest, { recursive: true });
  const cards = store.query(
    `SELECT c.*, GROUP_CONCAT(t.tag, ',') AS tags
     FROM cards c LEFT JOIN card_tags t ON t.card_id = c.id
     GROUP BY c.id ORDER BY c.employer, c.claim`
  );
  const moments = store.query('SELECT * FROM moments ORDER BY created_at');
  const timeline = store.query('SELECT * FROM timeline ORDER BY start DESC');
  const stubs = store.query('SELECT * FROM stubs');
  const positions = store.query('SELECT * FROM positions');
  const bindings = store.query('SELECT * FROM bindings');
  const voice = store.queryOne('SELECT * FROM voice_versions ORDER BY id DESC LIMIT 1');
  const doc = (name, data) => {
    fs.writeFileSync(path.join(dest, name), yaml.dump(data, { lineWidth: 100, noRefs: true }));
  };
  doc('cards.yaml', { cards });
  doc('moments.yaml', { moments });
  doc('timeline.yaml', { timeline, stubs });
  doc('positions.yaml', { positions, bindings });
  doc('voice-current.yaml', {
    id: voice && voice.id,
    kind: voice && voice.kind,
    text: (voice && voice.text) || '',
  });
  return dest;
}

module.exports = { dump, exportDir };
