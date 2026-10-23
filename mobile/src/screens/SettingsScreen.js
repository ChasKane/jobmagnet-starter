import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
const uiLocale = require('../../../lib/ui-locale');

function Switch({ on }) {
  return (
    <View style={[styles.switch, on && styles.switchOn]}>
      <View style={[styles.knob, on && styles.knobOn]} />
    </View>
  );
}

export default function SettingsScreen({
  open,
  settings,
  resumes,
  mail,
  bundlePath,
  onClose,
  onSaveSettings,
  onImportResume,
  onExport,
  onImportBundle,
  onMailImport,
  onOpenGmail,
  voice,
  systemPrompt,
  onSaveVoice,
  onSavePrompt,
}) {
  const [llmUrl, setLlmUrl] = useState((settings && settings.llmUrl) || '');
  const [llmKey, setLlmKey] = useState((settings && settings.llmKey) || '');
  const [mailPaste, setMailPaste] = useState('');
  const [queueN, setQueueN] = useState(String((settings && settings.autofillQueueN) || 0));
  const autofillOnOpen = Boolean(settings && settings.autofillOnOpen);
  const reviewGate = settings && settings.reviewGate !== false;
  const chatSound = !settings || settings.chatSound !== false;
  const handedness = settings && settings.handedness === 'left' ? 'left' : 'right';
  const uiLanguage = uiLocale.asUiLanguage(settings && settings.uiLanguage);
  const [voiceText, setVoiceText] = useState(voice || '');
  const [prompt, setPrompt] = useState(systemPrompt || '');

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.head}>
            <Text style={styles.title}>Settings</Text>
            <Pressable onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            <Text style={styles.group}>Behavior</Text>
            <Pressable style={styles.row} onPress={() => onSaveSettings({ chatSound: !chatSound })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Chat sounds</Text>
                <Text style={styles.help}>Chime when Magnet finishes chat, essays, or autofill</Text>
              </View>
              <Switch on={chatSound} />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={() => onSaveSettings({ autofillOnOpen: !autofillOnOpen })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Autofill on open</Text>
                <Text style={styles.help}>Fill when a posting loads</Text>
              </View>
              <Switch on={autofillOnOpen} />
            </Pressable>
            <Pressable
              style={styles.row}
              onPress={() => onSaveSettings({ handedness: handedness === 'left' ? 'right' : 'left' })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Left-handed</Text>
                <Text style={styles.help}>Flip conversation tabs, page tabs, and Send</Text>
              </View>
              <Switch on={handedness === 'left'} />
            </Pressable>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Page language</Text>
                <Text style={styles.help}>Force job-board and LinkedIn pages to this language, ignoring region.</Text>
                <View style={styles.langRow}>
                  {uiLocale.LANGUAGES.map((lang) => (
                    <Pressable
                      key={lang.id}
                      onPress={() => onSaveSettings({ uiLanguage: lang.id })}
                      style={[styles.langChip, uiLanguage === lang.id && styles.langChipOn]}
                    >
                      <Text style={[styles.langChipText, uiLanguage === lang.id && styles.langChipTextOn]}>
                        {lang.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            <Pressable style={styles.row} onPress={() => onSaveSettings({ reviewGate: !reviewGate })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Review gate</Text>
                <Text style={styles.help}>Pin essays before Complete</Text>
              </View>
              <Switch on={reviewGate} />
            </Pressable>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Autofill queue</Text>
                <Text style={styles.help}>After Autofill finishes, run the next N empty open jobs. 0 means do not queue.</Text>
              </View>
              <TextInput
                value={queueN}
                onChangeText={setQueueN}
                onEndEditing={() => {
                  const n = Math.max(0, Math.min(50, Math.round(Number(queueN) || 0)));
                  setQueueN(String(n));
                  onSaveSettings({ autofillQueueN: n });
                }}
                keyboardType="number-pad"
                style={styles.num}
              />
            </View>

            <Text style={styles.group}>Voice</Text>
            <TextInput
              value={voiceText}
              onChangeText={setVoiceText}
              multiline
              style={[styles.input, styles.tall]}
            />
            <Pressable style={styles.action} onPress={() => onSaveVoice && onSaveVoice(voiceText)}>
              <Text style={styles.actionText}>Save voice</Text>
            </Pressable>
            <Text style={styles.group}>System prompt</Text>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              multiline
              style={[styles.input, styles.tall]}
            />
            <Pressable style={styles.action} onPress={() => onSavePrompt && onSavePrompt(prompt)}>
              <Text style={styles.actionText}>Save prompt</Text>
            </Pressable>

            <Text style={styles.group}>LLM</Text>
            <TextInput
              value={llmUrl}
              onChangeText={setLlmUrl}
              placeholder="OpenAI-compatible URL"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={styles.input}
            />
            <TextInput
              value={llmKey}
              onChangeText={setLlmKey}
              placeholder="API key"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              secureTextEntry
              style={styles.input}
            />
            <Pressable style={styles.action} onPress={() => onSaveSettings({ llmUrl, llmKey })}>
              <Text style={styles.actionText}>Save LLM</Text>
            </Pressable>

            <Text style={styles.group}>Vault</Text>
            {(resumes || []).map((r) => (
              <Text key={r.id} style={styles.help}>
                {r.label} {r.isDefault ? '· default' : ''}
              </Text>
            ))}
            <Pressable style={styles.action} onPress={onImportResume}>
              <Text style={styles.actionText}>Import resume</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={onExport}>
              <Text style={styles.actionText}>Export bundle</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={onImportBundle}>
              <Text style={styles.actionText}>Import bundle</Text>
            </Pressable>
            <Text style={styles.help}>{bundlePath || 'magnet-bundle.json in app documents'}</Text>

            <Text style={styles.group}>Gmail</Text>
            <Text style={styles.help}>
              {mail && mail.connected
                ? `Signed in as ${mail.email || 'Gmail'}`
                : 'Sign in, then scan for recruiting replies.'}
              {mail && mail.pending ? ` · ${mail.pending} need review` : ''}
            </Text>
            <Pressable style={styles.action} onPress={onOpenGmail}>
              <Text style={styles.actionText}>{mail && mail.connected ? 'Open Gmail' : 'Sign in to Gmail'}</Text>
            </Pressable>
            <TextInput
              value={mailPaste}
              onChangeText={setMailPaste}
              placeholder="Or paste one email (From / subject / body)"
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, styles.tall]}
            />
            <Pressable
              style={styles.action}
              onPress={() => {
                onMailImport(mailPaste);
                setMailPaste('');
              }}
            >
              <Text style={styles.actionText}>Classify pasted mail</Text>
            </Pressable>
            <Pressable
              style={styles.action}
              onPress={() => Alert.alert('Android first', 'Sideload an APK. iOS is not a release target.')}
            >
              <Text style={styles.actionText}>About distribution</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(8, 10, 14, 0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    maxHeight: '80%',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: colors.text, fontSize: 13, fontWeight: '700' },
  close: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  closeText: { color: colors.muted, fontSize: 11 },
  group: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  label: { color: colors.text, fontSize: 12 },
  help: { color: colors.muted, fontSize: 10, marginTop: 2, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: 7,
    padding: 8,
    fontSize: 12,
    marginBottom: 6,
  },
  num: {
    width: 56,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: 7,
    padding: 8,
    fontSize: 13,
    textAlign: 'center',
  },
  tall: { minHeight: 88, textAlignVertical: 'top' },
  action: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: 7,
    padding: 8,
    marginBottom: 6,
  },
  actionText: { color: colors.text, fontSize: 12 },
  switch: {
    width: 36,
    height: 20,
    borderRadius: 99,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  switchOn: {
    backgroundColor: 'rgba(110, 168, 254, 0.35)',
    borderColor: 'rgba(110, 168, 254, 0.55)',
  },
  knob: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.muted },
  knobOn: { backgroundColor: colors.accent, alignSelf: 'flex-end' },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  langChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  langChipOn: {
    backgroundColor: 'rgba(110, 168, 254, 0.35)',
    borderColor: 'rgba(110, 168, 254, 0.55)',
  },
  langChipText: { color: colors.muted, fontSize: 11 },
  langChipTextOn: { color: colors.text, fontWeight: '600' },
});
