import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../theme';
import {
  EMAIL_JS,
  THREAD_IDS_JS,
  PRINT_HTML_JS,
  searchUrl,
  printUrl,
  parsePrintView,
  inboxUrl,
  oauthCallbackParams,
} from '../../../packages/core/src/gmail-web';
import { authUrl, exchangeCode, LOOPBACK_REDIRECT, APP_REDIRECT } from '../../../packages/core/src/gmail-api';

const GMAIL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/172.16.1.3 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function GmailScreen({
  open,
  mail,
  queue,
  settings,
  phase,
  onPhase,
  onClose,
  onSaveSettings,
  onConnected,
  onImported,
  onSignOut,
  onScanApi,
  onResolve,
  onBackRef,
  intent,
  threadHref,
}) {
  const webRef = useRef(null);
  const pending = useRef(new Map());
  const seq = useRef(0);
  const [url, setUrl] = useState('https://mail.google.com/mail/u/0/');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [canWebBack, setCanWebBack] = useState(false);
  const [clientId, setClientId] = useState((settings && settings.gmailClientId) || '');
  const [clientSecret, setClientSecret] = useState((settings && settings.gmailClientSecret) || '');

  useEffect(() => {
    if (!onBackRef) return;
    onBackRef.current = () => {
      if (phase === 'webview' && canWebBack && webRef.current) {
        webRef.current.goBack();
        return true;
      }
      if (phase === 'webview') {
        onPhase('idle');
        return true;
      }
      onClose();
      return true;
    };
    return () => {
      onBackRef.current = null;
    };
  }, [phase, canWebBack, onBackRef, onClose, onPhase]);

  const startedIntent = useRef(false);
  useEffect(() => {
    if (!open) {
      startedIntent.current = false;
      return;
    }
    if (threadHref) {
      startedIntent.current = true;
      onPhase('webview');
      setUrl(threadHref);
      return;
    }
    if (startedIntent.current || !intent) return;
    startedIntent.current = true;
    if (intent === 'signin') startSignIn();
    if (intent === 'scan') startScan();
  }, [open, intent, threadHref]);

  function evalJs(script) {
    const id = `g${seq.current++}`;
    return new Promise((resolve, reject) => {
      pending.current.set(id, { resolve, reject });
      webRef.current.injectJavaScript(`(async () => {
        try {
          const result = ${script};
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'gmail-eval', id: ${JSON.stringify(id)}, result }));
        } catch (err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'gmail-eval', id: ${JSON.stringify(id)}, error: String(err) }));
        }
      })(); true;`);
      setTimeout(() => {
        if (pending.current.has(id)) {
          pending.current.delete(id);
          reject(new Error('Gmail eval timeout'));
        }
      }, 10000);
    });
  }

  function onMessage(event) {
    let msg = event.nativeEvent.data;
    try {
      msg = JSON.parse(msg);
    } catch {
      return;
    }
    if (msg && msg.type === 'gmail-eval' && pending.current.has(msg.id)) {
      const { resolve, reject } = pending.current.get(msg.id);
      pending.current.delete(msg.id);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    }
  }

  async function finishOauth(href) {
    const params = oauthCallbackParams(href);
    if (!params) return false;
    if (params.error) {
      setStatus(params.error);
      onPhase('idle');
      return true;
    }
    if (!params.code) return false;
    setBusy(true);
    setStatus('Exchanging Google token…');
    try {
      const tokens = await exchangeCode({
        clientId: clientId || (settings && settings.gmailClientId),
        clientSecret: clientSecret || (settings && settings.gmailClientSecret),
        code: params.code,
        redirectUri: href.startsWith('jobmagnet:') ? APP_REDIRECT : LOOPBACK_REDIRECT,
      });
      onSaveSettings({ gmailAuth: tokens, gmailClientId: clientId, gmailClientSecret: clientSecret });
      onConnected({ email: tokens.email, reply: tokens.email ? `Signed in as ${tokens.email}.` : 'Signed in to Gmail.' });
      onPhase('idle');
      setStatus('');
    } catch (err) {
      setStatus(err.message || String(err));
      onPhase('idle');
    } finally {
      setBusy(false);
    }
    return true;
  }

  async function captureSession() {
    try {
      const email = await evalJs(EMAIL_JS);
      if (email) {
        onSaveSettings({ gmailAuth: { web: true, email, signed_in_at: new Date().toISOString() } });
        onConnected({ email, reply: `Signed in as ${email}.` });
        return email;
      }
    } catch (_) {}
    return '';
  }

  async function runWebScan() {
    setBusy(true);
    setStatus('Searching recruiting mail…');
    onPhase('webview');
    setUrl(searchUrl());
    await sleep(2800);
    let ids = [];
    try {
      ids = (await evalJs(THREAD_IDS_JS)) || [];
    } catch (err) {
      setStatus(err.message || 'Could not read the inbox. Sign in first.');
      setBusy(false);
      return;
    }
    const seen = { ...((settings && settings.gmailSeen) || {}) };
    const fresh = ids.filter((id) => id && !seen[id]).slice(0, 40);
    const messages = [];
    for (let i = 0; i < fresh.length; i += 1) {
      const id = fresh[i];
      setStatus(`Reading ${i + 1} / ${fresh.length}`);
      setUrl(printUrl(id));
      await sleep(1800);
      try {
        const html = await evalJs(PRINT_HTML_JS);
        messages.push(parsePrintView(html, id));
        seen[id] = true;
      } catch (_) {}
    }
    onSaveSettings({ gmailSeen: seen });
    await onImported(messages);
    setUrl('https://mail.google.com/mail/u/0/');
    onPhase('idle');
    setBusy(false);
    setStatus(fresh.length ? `Scanned ${fresh.length}.` : 'No new recruiting mail.');
  }

  function startSignIn() {
    setStatus('');
    if (clientId) {
      const href = authUrl({
        clientId,
        redirectUri: LOOPBACK_REDIRECT,
        email: mail && mail.email,
        forceConsent: true,
      });
      if (href) {
        onPhase('webview');
        setUrl(href);
        return;
      }
    }
    onPhase('webview');
    setUrl('https://mail.google.com/mail/u/0/');
  }

  async function startScan() {
    setStatus('');
    if (onScanApi) {
      try {
        const out = await onScanApi();
        if (out && out.ok !== false && !out.needUi && !out.needWebScan) {
          setStatus(out.reply || 'Scan finished.');
          return;
        }
      } catch (err) {
        setStatus(err.message || String(err));
      }
    }
    onPhase('webview');
    runWebScan();
  }

  const web = phase === 'webview';

  return (
    <Modal visible={open} animationType="slide" onRequestClose={() => (onBackRef && onBackRef.current ? onBackRef.current() : onClose())}>
      <View style={styles.screen}>
        <View style={styles.head}>
          <Text style={styles.title}>Gmail</Text>
          <Pressable
            onPress={() => (web ? onPhase('idle') : onClose())}
            style={styles.close}
          >
            <Text style={styles.closeText}>{web ? 'Inbox' : 'Done'}</Text>
          </Pressable>
        </View>

        {web ? (
          <View style={{ flex: 1 }}>
            {busy || status ? (
              <View style={styles.banner}>
                {busy ? <ActivityIndicator color={colors.accent} /> : null}
                <Text style={styles.bannerText}>{status || 'Gmail'}</Text>
              </View>
            ) : null}
            <WebView
              ref={webRef}
              source={{ uri: url }}
              userAgent={GMAIL_UA}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              javaScriptEnabled
              domStorageEnabled
              onMessage={onMessage}
              onNavigationStateChange={async (nav) => {
                setCanWebBack(Boolean(nav.canGoBack));
                if (await finishOauth(nav.url)) return;
                if (inboxUrl(nav.url)) captureSession();
              }}
              onShouldStartLoadWithRequest={(req) => {
                if (oauthCallbackParams(req.url)) {
                  finishOauth(req.url);
                  return false;
                }
                return true;
              }}
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 32 }}>
            <Text style={styles.kicker}>
              {mail && mail.connected
                ? mail.email
                  ? `Signed in as ${mail.email}`
                  : 'Signed in'
                : 'Not signed in'}
              {mail && mail.scanned_at ? ` · last scan ${String(mail.scanned_at).slice(0, 16)}` : ''}
            </Text>
            {status ? <Text style={styles.help}>{status}</Text> : null}
            <Text style={styles.help}>
              Sign in, then Scan inbox. Magnet archives rejections and application receipts out of your inbox, and notifies you about anything else.
            </Text>
            <View style={styles.rowBtns}>
              <Pressable onPress={startSignIn} style={styles.action}>
                <Text style={styles.actionText}>{mail && mail.connected ? 'Re-open inbox' : 'Sign in'}</Text>
              </Pressable>
              <Pressable onPress={startScan} style={styles.action}>
                <Text style={styles.actionText}>Scan inbox</Text>
              </Pressable>
              {mail && mail.connected ? (
                <Pressable onPress={onSignOut} style={styles.action}>
                  <Text style={styles.actionText}>Sign out</Text>
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.group}>Inbox review ({(queue || []).length})</Text>
            {(queue || []).length === 0 ? (
              <Text style={styles.help}>Nothing waiting. Scan after you apply.</Text>
            ) : (
              (queue || []).map((row) => (
                <View key={row.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{row.subject || row.id}</Text>
                  <Text style={styles.help}>
                    {row.reason || (row.decision && row.decision.reason) || ''} {row.from ? `· ${row.from}` : ''}
                  </Text>
                  {row.snippet ? <Text style={styles.help}>{row.snippet}</Text> : null}
                  <View style={styles.rowBtns}>
                    <Pressable onPress={() => onResolve(row.id, 'reject', row.decision && row.decision.url)} style={styles.mini}>
                      <Text style={styles.miniText}>Reject match</Text>
                    </Pressable>
                    <Pressable onPress={() => onResolve(row.id, 'skip')} style={styles.mini}>
                      <Text style={styles.miniText}>Not a reject</Text>
                    </Pressable>
                  </View>
                  {((row.candidates || (row.decision && row.decision.candidates) || []).slice(0, 4)).map((c) => (
                    <Pressable key={c.url} onPress={() => onResolve(row.id, 'reject', c.url)} style={styles.mini}>
                      <Text style={styles.miniText}>
                        Reject {c.company} {c.title ? `· ${c.title}` : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: 8 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgChrome,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  close: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  closeText: { color: colors.muted, fontSize: 11 },
  banner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.bgChrome,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bannerText: { color: colors.text, fontSize: 12 },
  kicker: { color: colors.text, fontSize: 13, fontWeight: '650', marginBottom: 8 },
  help: { color: colors.muted, fontSize: 11, marginBottom: 8, lineHeight: 16 },
  group: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
  },
  rowBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  action: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  actionText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  mini: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 6,
  },
  miniText: { color: colors.text, fontSize: 11 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    borderRadius: 7,
    padding: 8,
    fontSize: 12,
    marginBottom: 6,
  },
});
