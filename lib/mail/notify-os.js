function oneLine(item) {
  const subject = String((item && item.subject) || 'Recruiting mail').replace(/\s+/g, ' ').trim();
  const from = String((item && item.from) || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (from ? `${subject} — ${from}` : subject).slice(0, 180);
}

function notificationText(items) {
  const list = (items || []).filter((item) => item && (item.subject || item.from || item.id));
  if (!list.length) return null;
  const title = list.length === 1 ? 'JobMagnet' : `JobMagnet · ${list.length} emails`;
  const body =
    list.length === 1 ? oneLine(list[0]) : list.slice(0, 3).map((item) => item.subject || item.from || 'Mail').join(' · ');
  const href =
    list.length === 1 && list[0].href ? list[0].href : 'https://mail.google.com/mail/u/0/#inbox';
  return { title, body: String(body).slice(0, 180), href };
}

function appleString(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

function notificationScript(items) {
  const note = notificationText(items);
  if (!note) return '';
  return `display notification ${appleString(note.body)} with title ${appleString(note.title)}`;
}

function showElectron(note) {
  try {
    const { Notification, shell } = require('electron');
    if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) return false;
    const banner = new Notification({ title: note.title, body: note.body });
    if (note.href && shell && typeof shell.openExternal === 'function') {
      banner.on('click', () => {
        shell.openExternal(note.href).catch(() => {});
      });
    }
    banner.show();
    return true;
  } catch {
    return false;
  }
}

function notifyMail(items) {
  const note = notificationText(items);
  if (!note || process.env.NODE_TEST_CONTEXT) return 0;
  if (showElectron(note)) return (items || []).length;
  if (process.platform !== 'darwin') return 0;
  const script = notificationScript(items);
  if (!script) return 0;
  const { execFile } = require('child_process');
  execFile('/usr/bin/osascript', ['-e', script], () => {});
  return (items || []).length;
}

module.exports = { notificationText, notificationScript, notifyMail };
