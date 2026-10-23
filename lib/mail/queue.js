const { loadQueue, saveQueue } = require('./cache');

function listQueue() {
  return loadQueue();
}

function addQueue(item) {
  const queue = loadQueue().filter((row) => row.id !== item.id);
  queue.push(item);
  saveQueue(queue);
  return queue;
}

function removeQueue(id) {
  const queue = loadQueue().filter((row) => row.id !== id);
  saveQueue(queue);
  return queue;
}

function getQueueItem(id) {
  return loadQueue().find((row) => row.id === id) || null;
}

function queueForUrl(url, company) {
  const foldCo = String(company || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return loadQueue().filter((row) => {
    if ((row.candidates || []).some((c) => c.url === url)) return true;
    if (foldCo && String(row.company || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === foldCo) return true;
    return false;
  });
}

module.exports = { listQueue, addQueue, removeQueue, getQueueItem, queueForUrl };
