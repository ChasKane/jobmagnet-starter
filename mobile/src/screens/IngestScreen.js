import { useState } from 'react';
import {
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

export default function IngestScreen({ messages, busy, plan, onBack, onSend, onApprove, onAnswer }) {
  const [draft, setDraft] = useState('');
  const schema = plan || lastPlan(messages);
  const lastAsk = [...(messages || [])].reverse().find((m) => m.asks && m.asks.length);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <View style={styles.head}>
        <Pressable onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.title}>Ingest</Text>
      </View>
      <ScrollView style={styles.log} contentContainerStyle={{ paddingBottom: 16 }}>
        {!(messages || []).length ? (
          <Text style={styles.muted}>
            Describe the search (title, remote, pay, how many — default 50) or paste apply URLs. Hit Go and Magnet hunts
            LinkedIn and the other boards while signed in until it has enough new matches.
          </Text>
        ) : null}
        {(messages || []).map((m, i) => {
          const you = m.role === 'you' || m.role === 'user';
          return (
            <View key={`${m.at}-${i}`} style={[styles.msg, you ? styles.msgYou : styles.msgMagnet]}>
              <View style={[styles.bubble, you ? styles.bubbleYou : styles.bubbleMagnet]}>
                <Text style={[styles.bubbleText, you && styles.bubbleTextYou]}>{m.text}</Text>
              </View>
              {lastAsk === m && (m.asks || []).map((q) => (
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
              ))}
              <Text style={styles.time}>{bubbleTime(m.at)}</Text>
            </View>
          );
        })}
        {busy ? <Text style={styles.muted}>Working…</Text> : null}
      </ScrollView>
      {schema ? (
        <View style={styles.plan}>
          <Text style={styles.planHead}>Search plan</Text>
          {planLines(schema).map((row) => (
            <View key={row.label} style={styles.planRow}>
              <Text style={styles.planLabel}>{row.label}</Text>
              <Text style={styles.planValue}>{row.value}</Text>
            </View>
          ))}
          <Pressable onPress={() => onApprove(schema)} disabled={busy} style={styles.approve}>
            <Text style={styles.approveText}>Go</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.compose}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Talk to Ingest…"
          placeholderTextColor={colors.muted}
          style={styles.input}
          editable={!busy}
          multiline
        />
        <Pressable
          onPress={() => {
            const text = draft.trim();
            if (!text) return;
            onSend(text);
            setDraft('');
          }}
          disabled={busy}
          style={[styles.btn, styles.btnPrimary]}
        >
          <Text style={styles.btnText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgChrome,
  },
  back: {
    width: 36,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: colors.text, fontSize: 14 },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  log: { flex: 1, padding: 12 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 8 },
  msg: { marginBottom: 10, maxWidth: '92%' },
  msgYou: { alignSelf: 'flex-end' },
  msgMagnet: { alignSelf: 'flex-start' },
  bubble: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
  },
  bubbleYou: { backgroundColor: 'rgba(110, 168, 254, 0.16)', borderColor: 'rgba(110, 168, 254, 0.35)' },
  bubbleMagnet: { backgroundColor: colors.bgElevated, borderColor: colors.border },
  bubbleText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  bubbleTextYou: { color: colors.text },
  time: { color: colors.muted, fontSize: 10, marginTop: 4 },
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
  compose: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 10,
    backgroundColor: colors.bgChrome,
    gap: 8,
  },
  input: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  btn: { alignSelf: 'flex-end', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
