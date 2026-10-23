import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';

export default function DashboardScreen({
  job,
  record,
  onNote,
  onEvent,
  onContact,
  mail,
  queue,
  onGmail,
  onScanMail,
  onResolveMail,
}) {
  const [note, setNote] = useState((record && record.prep_notes) || '');
  const [eventTitle, setEventTitle] = useState('');
  const [contactName, setContactName] = useState('');
  const events = ((record && record.events) || []).filter((e) => !e.deleted);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.kicker}>
        {(record && record.status) || (job && job.status) || 'open'} · process
      </Text>
      <View style={styles.mailRow}>
        <Pressable onPress={onGmail} style={styles.mailBtn}>
          <Text style={styles.mailBtnText}>
            {mail && mail.connected ? mail.email || 'Gmail signed in' : 'Sign in to Gmail'}
          </Text>
        </Pressable>
        <Pressable onPress={onScanMail} style={styles.mailBtn}>
          <Text style={styles.mailBtnText}>Scan inbox</Text>
        </Pressable>
      </View>
      {(queue || []).length > 0 ? (
        <>
          <Text style={styles.h2}>Inbox review ({queue.length})</Text>
          {queue.map((row) => (
            <View key={row.id} style={styles.event}>
              <Text style={styles.eventTitle}>{row.subject || row.id}</Text>
              <Text style={styles.muted}>{row.from}</Text>
              <Pressable onPress={() => onResolveMail(row.id, 'reject', row.decision && row.decision.url)} style={styles.btn}>
                <Text style={styles.btnText}>Reject match</Text>
              </Pressable>
              <Pressable onPress={() => onResolveMail(row.id, 'skip')} style={[styles.btn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }]}>
                <Text style={[styles.btnText, { color: colors.text }]}>Not a reject</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}
      {events.length === 0 ? (
        <Text style={styles.muted}>No events yet. Complete or add a note.</Text>
      ) : (
        events.map((e, i) => (
          <View key={`${e.at}-${i}`} style={styles.event}>
            <Text style={styles.eventTitle}>{e.title || e.type}</Text>
            <Text style={styles.muted}>{String(e.at || '').slice(0, 16)}</Text>
          </View>
        ))
      )}

      <Text style={styles.h2}>People</Text>
      {((record && record.contacts) || []).map((c) => (
        <Text key={c.id} style={styles.row}>
          {c.name}
          {c.role ? ` · ${c.role}` : ''}
          {c.email ? ` · ${c.email}` : ''}
        </Text>
      ))}
      <TextInput
        value={contactName}
        onChangeText={setContactName}
        placeholder="Contact name"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Pressable
        style={styles.btn}
        onPress={() => {
          if (!contactName.trim()) return;
          onContact({ name: contactName.trim() });
          setContactName('');
        }}
      >
        <Text style={styles.btnText}>Add contact</Text>
      </Pressable>

      <Text style={styles.h2}>Notes</Text>
      <TextInput value={note} onChangeText={setNote} multiline style={[styles.input, styles.tall]} />
      <Pressable style={styles.btn} onPress={() => onNote(note)}>
        <Text style={styles.btnText}>Save notes</Text>
      </Pressable>

      <Text style={styles.h2}>Event</Text>
      <TextInput
        value={eventTitle}
        onChangeText={setEventTitle}
        placeholder="Add event title"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Pressable
        style={styles.btn}
        onPress={() => {
          if (!eventTitle.trim()) return;
          onEvent({ type: 'note', title: eventTitle.trim() });
          setEventTitle('');
        }}
      >
        <Text style={styles.btnText}>Append event</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  kicker: { color: colors.muted, fontSize: 11, marginBottom: 8 },
  mailBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  mailBtnText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  mailRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  h2: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 12, marginBottom: 6, lineHeight: 18 },
  row: { color: colors.text, fontSize: 12, marginBottom: 6 },
  event: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  eventTitle: { color: colors.text, fontSize: 12, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    fontSize: 12,
  },
  tall: { minHeight: 88, textAlignVertical: 'top' },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
