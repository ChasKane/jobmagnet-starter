const { spawn } = require('child_process');

/** Run a Node sidecar even when the parent is Electron. */
function spawnNode(script, opts = {}) {
  return spawn(process.execPath, [script], {
    ...opts,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(opts.env || {}) },
  });
}

module.exports = { spawnNode };
