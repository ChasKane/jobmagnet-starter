import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, DESKTOP_UA } from '../theme';
import { BRIDGE_SCRIPT } from '../magnet/scripts';
const uiLocale = require('../../../lib/ui-locale');

export default function HuntLayer({
  webRef,
  url,
  loginOpen,
  loginPrompt,
  width,
  height,
  onMessage,
  onSignedIn,
  onSkip,
  uiLanguage,
}) {
  const href = String(url || '').trim() || 'about:blank';
  const source = href === 'about:blank' ? { uri: href } : uiLocale.pageSource(href, uiLanguage);
  return (
    <View
      collapsable={false}
      pointerEvents={loginOpen ? 'auto' : 'none'}
      style={
        loginOpen
          ? [styles.fill, styles.login]
          : [styles.offscreen, { width, height, left: width + 48 }]
      }
    >
      {loginOpen ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{loginPrompt || 'Sign in, then tap I’m signed in.'}</Text>
          <View style={styles.bannerRow}>
            <Pressable onPress={onSkip} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnText}>Skip this site</Text>
            </Pressable>
            <Pressable onPress={onSignedIn} style={[styles.btn, styles.btnPrimary]}>
              <Text style={styles.btnText}>I’m signed in</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <WebView
        ref={webRef}
        source={source}
        userAgent={DESKTOP_UA}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows
        onMessage={(e) => onMessage(e.nativeEvent.data)}
        injectedJavaScript={BRIDGE_SCRIPT}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, zIndex: 40 },
  login: { backgroundColor: colors.bg },
  offscreen: { position: 'absolute', top: 0, zIndex: -1, opacity: 1 },
  web: { flex: 1, backgroundColor: '#0f172a' },
  banner: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgChrome,
    gap: 8,
  },
  bannerText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  bannerRow: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  btnPrimary: { backgroundColor: colors.primary, borderColor: 'rgba(59, 130, 246, 0.85)' },
  btnGhost: { backgroundColor: 'transparent', borderColor: colors.border },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
