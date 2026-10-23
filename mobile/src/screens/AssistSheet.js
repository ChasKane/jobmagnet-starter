import { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme';
const { planLines } = require('../../../packages/core/src/search-schema');
const chatTabs = require('../../../lib/chat-tabs');

const PAGE_RIGHT = [
  { id: 'jd', label: 'JD' },
  { id: 'review', label: 'Review' },
  { id: 'chat', label: 'Chat' },
];
const PAGE_LEFT = [
  { id: 'chat', label: 'Chat' },
  { id: 'review', label: 'Review' },
  { id: 'jd', label: 'JD' },
];

function bubbleTime(at) {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function lastPlan(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && list[i].plan) return list[i].plan;
  }
  return null;
}

export default function AssistSheet({
  tab,
  onTab,
  chat,
  onSend,
  leftovers,
  onAccept,
  onSkip,
  onRewrite,
  onLearn,
  jdText,
  onPasteJd,
  modelId,
  models,
  onModel,
  target,
  onClearTarget,
  onOpenMail,
  onResolveMail,
  conversationKey,
  onSelectConversation,
  conversationItems,
  handedness,
  seeAll,
  onSeeAll,
  ingestBusy,
  ingestPlan,
  onApprove,
  onAnswer,
  canOpenJob,
  openLabel,
  onOpenJob,
}) {
  const [draft, setDraft] = useState('');
  const [keyboardUp, setKeyboardUp] = useState(false);
  const ingest = conversationKey === chatTabs.INGEST_KEY;
  const left = handedness === 'left';
  const pageTabs = left ? PAGE_LEFT : PAGE_RIGHT;
  const messages = chat || [];
  const schema = ingestPlan || lastPlan(messages);
  const lastAsk = [...messages].reverse().find((m) => m.asks && m.asks.length);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const packed = useMemo(() => {
    const labels = {};
    for (const row of conversationItems || []) labels[row.key] = row.label;
    return chatTabs.packSubtabs({
      mru: (conversationItems || []).filter((row) => row.kind === 'job').map((row) => row.key),
      active: conversationKey || chatTabs.INGEST_KEY,
      handedness: left ? 'left' : 'right',
      jobFit: 3,
      labels,
    });
  }, [conversationItems, conversationKey, left]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      {seeAll ? (
        <View style={styles.seeAll}>
          <View style={styles.seeAllHead}>
            <Pressable onPress={() => onSeeAll(false)} style={styles.back}>
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <Text style={styles.seeAllTitle}>All chats</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
            {(conversationItems || [])
              .filter((row) => row.kind === 'job')
              .map((row) => (
                <Pressable
                  key={row.key}
                  onPress={() => {
                    onSeeAll(false);
                    onSelectConversation(row.key);
                  }}
                  style={styles.seeAllRow}
                >
                  <Text style={styles.seeAllLabel}>{row.label}</Text>
                  <Text style={styles.muted}>{row.title || row.company || ''}</Text>
                </Pressable>
              ))}
          </ScrollView>
        </View>
      ) : (
        <>
          <View style={[styles.railTabs, left && styles.rowReverse]}>
            <ScrollView horizontal contentContainerStyle={[styles.railTabsInner, left && styles.rowReverse]}>
              {packed.pills.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => onSelectConversation(item.key)}
                  style={[styles.railTab, conversationKey === item.key && styles.railTabOn]}
                >
                  <Text style={[styles.railTabText, conversationKey === item.key && styles.railTabTextOn]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => onSeeAll(true)} style={styles.railMore}>
              <Text style={styles.railMoreText}>…</Text>
            </Pressable>
          </View>

          {!ingest && !keyboardUp ? (
            <View style={[styles.railTabs, left && styles.rowReverse]}>
              {pageTabs.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => onTab(item.id)}
                  style={[styles.railTab, tab === item.id && styles.railTabOn]}
                >
                  <Text style={[styles.railTabText, tab === item.id && styles.railTabTextOn]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {canOpenJob && (ingest || tab === 'chat') ? (
            <Pressable onPress={onOpenJob} style={styles.openBar}>
              <Text style={styles.openCopy}>{openLabel || 'Open'} to apply</Text>
              <Text style={styles.openBtn}>{openLabel || 'Open'}</Text>
            </Pressable>
          ) : null}

          {ingest && schema ? (
            <View style={styles.plan}>
              <Text style={styles.planHead}>Search plan</Text>
              {planLines(schema).map((row) => (
                <View key={row.label} style={styles.planRow}>
                  <Text style={styles.planLabel}>{row.label}</Text>
                  <Text style={styles.planValue}>{row.value}</Text>
                </View>
              ))}
              <Pressable onPress={() => onApprove(schema)} disabled={ingestBusy} style={styles.approve}>
                <Text style={styles.approveText}>Go</Text>
              </Pressable>
            </View>
          ) : null}

          {!ingest && tab === 'review' ? (
            <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
              {(leftovers || []).length === 0 ? (
                <Text style={styles.muted}>Nothing to review.</Text>
              ) : (
                leftovers.map((row) => (
                  <View key={row.id} style={styles.review}>
                    <Text style={styles.reviewKind}>{row.kind || 'Field'}</Text>
                    <Text style={styles.reviewLabel}>{row.label || row.id}</Text>
                    <Text style={styles.reviewWhy}>
                      {row.reason || ''}
                      {row.intended ? ` → ${row.intended}` : ''}
                    </Text>
                    <View style={styles.reviewActions}>
                      <Pressable onPress={() => onSkip(row)} style={[styles.btn, styles.btnGhost]}>
                        <Text style={styles.ghostText}>Skip</Text>
                      </Pressable>
                      {onRewrite ? (
                        <Pressable onPress={() => onRewrite(row)} style={[styles.btn, styles.btnGhost]}>
                          <Text style={styles.ghostText}>Rewrite</Text>
                        </Pressable>
                      ) : null}
                      {onLearn && row.intended ? (
                        <Pressable onPress={() => onLearn(row)} style={[styles.btn, styles.btnGhost]}>
                          <Text style={styles.ghostText}>Learn</Text>
                        </Pressable>
                      ) : null}
                      <Pressable onPress={() => onAccept(row)} style={[styles.btn, styles.btnPrimary]}>
                        <Text style={styles.btnText}>Keep</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          ) : !ingest && tab === 'jd' ? (
            <ScrollView style={styles.body}>
              <Text style={styles.jd}>{jdText || 'No JD captured yet. Run Autofill ▾ JD.'}</Text>
              {onPasteJd ? (
                <Pressable onPress={onPasteJd} style={[styles.btn, styles.btnPrimary, { marginTop: 12, alignSelf: 'flex-start' }]}>
                  <Text style={styles.btnText}>Paste JD</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          ) : (
            <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 16 }}>
              {!messages.length ? (
                <Text style={styles.muted}>
                  {ingest
                    ? 'Describe the search (title, remote, pay, how many — default 50) or paste apply URLs. Hit Go and Magnet hunts LinkedIn and the other boards while signed in until it has enough new matches.'
                    : 'Chat stays with this job. Name another company to reuse a draft, or say “use what I wrote.”'}
                </Text>
              ) : null}
              {messages.map((m, i) => {
                const you = m.role === 'you' || m.role === 'user';
                return (
                  <View key={`${m.at}-${i}`} style={[styles.msg, you ? styles.msgYou : styles.msgMagnet]}>
                    <View style={[styles.bubble, you ? styles.bubbleYou : styles.bubbleMagnet, m.kind === 'mail' && styles.bubbleMail]}>
                      <Text style={[styles.bubbleText, you && styles.bubbleTextYou]}>{m.text}</Text>
                    </View>
                    {lastAsk === m && (ingest || tab === 'chat')
                      ? (m.asks || []).map((q) => (
                          <View key={q.id} style={styles.ask}>
                            {(q.options || []).map((opt) => (
                              <Pressable
                                key={opt.id || opt.label}
                                onPress={() => onAnswer && onAnswer(m.asks, { [q.id]: opt.label })}
                                style={styles.askOpt}
                              >
                                <Text style={styles.askOptText}>{opt.label}</Text>
                              </Pressable>
                            ))}
                          </View>
                        ))
                      : null}
                    {m.kind === 'mail' ? (
                      <View style={styles.mailActions}>
                        <Pressable onPress={() => onOpenMail && onOpenMail(m.href)} style={[styles.btn, styles.btnGhost]}>
                          <Text style={styles.ghostText}>Open email</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onResolveMail && onResolveMail(m.mailId, 'skip')}
                          style={[styles.btn, styles.btnGhost]}
                        >
                          <Text style={styles.ghostText}>Not a reject</Text>
                        </Pressable>
                        {(m.candidates || []).slice(0, 4).map((c) =>
                          c && c.url ? (
                            <Pressable
                              key={c.url}
                              onPress={() => onResolveMail && onResolveMail(m.mailId, 'reject', c.url)}
                              style={[styles.btn, styles.btnGhost]}
                            >
                              <Text style={styles.ghostText}>Reject {c.company || 'this job'}</Text>
                            </Pressable>
                          ) : null
                        )}
                      </View>
                    ) : null}
                    <Text style={styles.time}>{bubbleTime(m.at)}</Text>
                  </View>
                );
              })}
              {ingestBusy ? <Text style={styles.muted}>Working…</Text> : null}
            </ScrollView>
          )}

          {target && !ingest && tab === 'chat' ? (
            <Pressable onPress={onClearTarget} style={[styles.target, left && styles.rowReverse]}>
              <Text style={styles.targetMark}>FIELD</Text>
              <Text style={styles.targetLabel} numberOfLines={1}>
                {target.label || target.id}
              </Text>
            </Pressable>
          ) : null}

          {ingest || tab === 'chat' ? (
            <View style={styles.compose}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={ingest ? 'Talk to Ingest…' : 'Talk to Magnet…'}
                placeholderTextColor={colors.muted}
                style={styles.input}
                multiline
              />
              <View style={[styles.composeBar, left && styles.rowReverse]}>
                <Pressable
                  onPress={() => {
                    if (!onModel || !(models || []).length) return;
                    const ids = models.map((m) => m.id || m);
                    const cur = modelId || ids[0];
                    const idx = Math.max(0, ids.indexOf(cur));
                    onModel(ids[(idx + 1) % ids.length]);
                  }}
                  style={styles.model}
                >
                  <Text style={styles.modelText}>{modelId || 'Model'} ▾</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const text = draft.trim();
                    if (!text) return;
                    onSend(text);
                    setDraft('');
                  }}
                  style={[styles.btn, styles.btnPrimary]}
                >
                  <Text style={styles.btnText}>Send</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  rowReverse: { flexDirection: 'row-reverse' },
  railTabs: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgChrome,
  },
  railTabsInner: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 6 },
  railTab: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 7 },
  railTabOn: { borderTopWidth: 2, borderTopColor: colors.primary, paddingTop: 6 },
  railTabText: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  railTabTextOn: { color: colors.text },
  railMore: { width: 32, alignItems: 'center', justifyContent: 'center' },
  railMoreText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  openBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  openCopy: { color: colors.muted, fontSize: 12 },
  openBtn: { color: colors.text, fontSize: 12, fontWeight: '700' },
  plan: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.bgElevated,
  },
  planHead: { color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  planRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  planLabel: { color: colors.muted, fontSize: 11, width: 72 },
  planValue: { color: colors.text, fontSize: 11, flex: 1 },
  approve: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  approveText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  body: { flex: 1, padding: 12 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  jd: { color: '#c5cad6', fontSize: 12, lineHeight: 18 },
  msg: { marginBottom: 10, maxWidth: '92%' },
  msgYou: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgMagnet: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
  bubbleYou: { backgroundColor: colors.you, borderBottomRightRadius: 4 },
  bubbleMagnet: { backgroundColor: colors.magnet, borderBottomLeftRadius: 4 },
  bubbleMail: { backgroundColor: '#3a2f22' },
  mailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  bubbleText: { color: '#c5cad6', fontSize: 13, lineHeight: 18 },
  bubbleTextYou: { color: '#f8fafc' },
  time: { color: '#6b7386', fontSize: 10, marginTop: 4, paddingHorizontal: 4 },
  ask: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  askOpt: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  askOptText: { color: colors.text, fontSize: 11 },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 10,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#2a2438',
  },
  targetMark: { color: '#c4b5fd', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  targetLabel: { color: colors.text, fontSize: 11, flex: 1 },
  compose: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgChrome,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 6,
  },
  input: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    borderRadius: 7,
    padding: 8,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  composeBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  model: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modelText: { color: colors.text, fontSize: 11 },
  review: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  reviewKind: { color: colors.gold, fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase' },
  reviewLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginVertical: 4 },
  reviewWhy: { color: colors.muted, fontSize: 11 },
  reviewActions: { flexDirection: 'row', gap: 6, marginTop: 8 },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnPrimary: { backgroundColor: colors.primary, borderColor: 'rgba(59, 130, 246, 0.85)' },
  btnGhost: { backgroundColor: 'transparent', borderColor: colors.border },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  ghostText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  seeAll: { flex: 1 },
  seeAllHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: {
    width: 36,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: colors.text, fontSize: 14 },
  seeAllTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  seeAllRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    backgroundColor: colors.bgElevated,
  },
  seeAllLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },
});
