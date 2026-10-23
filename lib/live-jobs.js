function listLiveJobs() {
  const persist = require('../packages/persist');
  persist.open();
  return persist.nodeStore().listJobs();
}

module.exports = { listLiveJobs };
