const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const HOOK = `
        try {
          Class<?> cls = Class.forName("app.jobmagnet.magnetchooser.MagnetChooserModule");
          java.lang.reflect.Method take = cls.getMethod("takePending");
          Object uri = take.invoke(null);
          if (uri instanceof android.net.Uri && filePathCallback != null) {
            filePathCallback.onReceiveValue(new android.net.Uri[] { (android.net.Uri) uri });
            return true;
          }
        } catch (Throwable ignored) {}
`;

function patch(contents) {
  if (contents.includes('MagnetChooserModule')) return contents;
  const marker = 'onShowFileChooser(';
  const idx = contents.indexOf(marker);
  if (idx < 0) return contents;
  const brace = contents.indexOf('{', idx);
  if (brace < 0) return contents;
  return contents.slice(0, brace + 1) + HOOK + contents.slice(brace + 1);
}

module.exports = function withMagnetChooser(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const candidates = [
        path.join(root, 'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewManagerImpl.java'),
        path.join(root, 'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java'),
        path.join(root, 'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebChromeClient.java'),
      ];
      for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        const next = patch(fs.readFileSync(file, 'utf8'));
        if (next !== fs.readFileSync(file, 'utf8')) fs.writeFileSync(file, next);
      }
      return cfg;
    },
  ]);
};
