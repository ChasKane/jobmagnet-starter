const { NativeModules } = require('react-native');

const native = NativeModules.MagnetChooser;

module.exports = {
  arm(path, filename, bytes) {
    if (!native || typeof native.arm !== 'function') return Promise.resolve(false);
    return native.arm(String(path || ''), String(filename || 'resume.pdf'), String(bytes || ''));
  },
  pendingUri() {
    return native && native.pendingUri ? native.pendingUri() : null;
  },
};
