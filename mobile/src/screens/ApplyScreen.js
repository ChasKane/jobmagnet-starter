import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, DESKTOP_UA } from '../theme';
import { CONTOSO_HTML } from '../fixtures/contoso';
import { BRIDGE_SCRIPT } from '../magnet/scripts';
const uiLocale = require('../../../lib/ui-locale');

const STAGES = [
  { id: 'jd', label: 'JD' },
  { id: 'resume', label: 'Resume' },
  { id: 'fill', label: 'Fill' },
  { id: 'essay', label: 'Essay' },
];

const AUTOFILL_STEPS = [
  { id: 'JD', label: 'JD' },
  { id: 'Apply?', label: 'Apply?' },
  { id: 'Fill', label: 'Fill' },
  { id: 'Review', label: 'Review' },
  { id: 'Essays', label: 'Essays' },
  { id: 'Done', label: 'Done' },
];

function canTogglePosting(job) {
  const bucket = job && (job.bucket || job.status);
  return bucket === 'submitted' || bucket === 'passed';
}

function Chip({ label, value, onPress }) {
  const inner = (
    <>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={styles.chipValue} numberOfLines={1}>
        {value || '—'}
      </Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={styles.chip}>
        {inner}
      </Pressable>
    );
  }
  return <View style={styles.chip}>{inner}</View>;
}

function Steps({ current, running }) {
  const scrollRef = useRef(null);
  if (!running) return null;
  const idx = AUTOFILL_STEPS.findIndex((s) => s.id === current);
  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pointerEvents="none"
      showsHorizontalScrollIndicator={false}
      style={styles.steps}
      contentContainerStyle={styles.stepsInner}
    >
      {AUTOFILL_STEPS.map((step, i) => {
        const isDone = idx >= 0 && i < idx;
        const isCurrent = step.id === current;
        return (
          <View
            key={step.id}
            style={styles.step}
            onLayout={(e) => {
              if (!isCurrent || !scrollRef.current) return;
              scrollRef.current.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 16), animated: true });
            }}
          >
            <View style={[styles.mark, isDone && styles.markDone, isCurrent && styles.markCurrent]}>
              <Text style={[styles.markText, isDone && styles.markTextDone, isCurrent && styles.markTextCurrent]}>
                {isDone ? '✓' : String(i + 1)}
              </Text>
            </View>
            <Text style={[styles.stepLabel, isDone && styles.stepLabelDone, isCurrent && styles.stepLabelCurrent]}>
              {isCurrent && step.id === 'Essays' ? 'Essays' : step.label}
            </Text>
            {i < AUTOFILL_STEPS.length - 1 ? <Text style={styles.chev}>›</Text> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

export default function ApplyScreen({
  job,
  webRef,
  onMessage,
  onNav,
  onAutofill,
  onStage,
  onComplete,
  onPass,
  onToggleSurface,
  onResume,
  surface,
  dashboard,
  status,
  busy,
  resumeLabel,
  stepCurrent,
  splitOpen,
  onSplit,
  uiLanguage,
}) {
  const [chipsOpen, setChipsOpen] = useState(false);
  const sample = job && job.url && String(job.url).startsWith('magnet://sample/');
  const source = sample
    ? { html: CONTOSO_HTML, baseUrl: 'https://jobs.contoso.example/' }
    : job && job.url
      ? uiLocale.pageSource(job.url, uiLanguage)
      : { uri: job && job.url };
  const closed = canTogglePosting(job);
  const applying = job && !closed && job.id !== '__hunt__';
  const onDash = surface === 'dash';

  return (
    <View style={styles.screen}>
      <View style={styles.tracker}>
        <View style={styles.trackerRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.company} numberOfLines={1}>
              {job && job.id === '__hunt__' ? 'Hunt' : (job && (job.company || job.name)) || 'No job selected'}
            </Text>
            <Text style={styles.title} numberOfLines={1}>
              {job && job.id === '__hunt__'
                ? 'Sign in if asked — searching…'
                : job
                  ? [job.title, job.location].filter(Boolean).join(' · ')
                  : 'Open a row from Jobs'}
            </Text>
          </View>
          {closed ? (
            <Pressable onPress={onToggleSurface} style={styles.surfaceSwitch}>
              <Text style={styles.surfaceSwitchText}>{onDash ? 'Posting' : 'Dashboard'}</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => setChipsOpen((v) => !v)} style={styles.chipToggle} hitSlop={8}>
          <Text style={styles.chipToggleText}>{chipsOpen ? '▾' : '▴'}</Text>
        </Pressable>
        {chipsOpen ? (
          <View style={styles.meta}>
            <Chip label="Salary" value={job && job.salary} />
            <Chip label="YoE" value={job && job.yoe} />
            <Chip label="Level" value={job && job.level} />
            <Chip label="Resume" value={resumeLabel} onPress={onResume} />
          </View>
        ) : null}
        <Steps current={stepCurrent} running={Boolean(busy)} />
      </View>

      <View style={styles.web}>
        {job && job.url ? (
          <View style={{ flex: 1, display: onDash ? 'none' : 'flex' }}>
            <WebView
              ref={(r) => {
                if (typeof webRef === 'function') webRef(r);
                else if (webRef) webRef.current = r;
              }}
              source={source}
              userAgent={DESKTOP_UA}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows
              onMessage={(e) => onMessage(e.nativeEvent.data)}
              onNavigationStateChange={onNav}
              injectedJavaScript={BRIDGE_SCRIPT}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              )}
            />
          </View>
        ) : !onDash ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Pick a job in Jobs, or paste a URL there and Go.</Text>
          </View>
        ) : null}
        {onDash ? dashboard : null}
      </View>

      {applying ? (
        <View style={styles.footer}>
          {status ? (
            <Text style={styles.status} numberOfLines={2}>
              {status}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable onPress={onComplete} disabled={!job || busy} style={[styles.btn, styles.btnPrimary]}>
              <Text style={styles.btnText}>Complete</Text>
            </Pressable>
            <View style={styles.split}>
              <Pressable
                onPress={onAutofill}
                disabled={!job || busy}
                style={[styles.btn, styles.btnAutofill, styles.splitMain]}
              >
                <Text style={styles.btnText}>{busy ? 'Cancel' : 'Autofill'}</Text>
              </Pressable>
              <Pressable onPress={onSplit} disabled={!job} style={[styles.btn, styles.btnAutofill, styles.splitArrow]}>
                <Text style={styles.btnText}>▾</Text>
              </Pressable>
            </View>
            <Pressable onPress={onPass} disabled={!job} style={[styles.btn, styles.btnDanger]}>
              <Text style={styles.btnText}>Pass</Text>
            </Pressable>
          </View>
          {splitOpen ? (
            <View style={styles.splitMenu}>
              {STAGES.map((stage) => (
                <Pressable key={stage.id} onPress={() => onStage(stage.id)} style={[styles.btn, styles.btnStage]}>
                  <Text style={styles.btnText}>{stage.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : status ? (
        <View style={styles.footer}>
          <Text style={styles.status} numberOfLines={2}>
            {status}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  tracker: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgChrome,
    gap: 8,
  },
  trackerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  company: { color: colors.text, fontSize: 13, fontWeight: '700' },
  title: { color: colors.muted, fontSize: 11, marginTop: 2 },
  surfaceSwitch: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  surfaceSwitchText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  chipToggle: {
    alignSelf: 'flex-end',
    width: 34,
    height: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -8,
  },
  chipToggleText: { color: colors.muted, fontSize: 8, lineHeight: 10 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    minWidth: 72,
    flexGrow: 1,
    flexBasis: 72,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipLabel: {
    color: colors.muted,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  chipValue: { color: colors.text, fontSize: 12, fontWeight: '600', marginTop: 1 },
  steps: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.chip,
  },
  stepsInner: { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  step: { flexDirection: 'row', alignItems: 'center' },
  mark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markDone: { backgroundColor: '#14532d', borderColor: 'rgba(74, 222, 128, 0.7)' },
  markCurrent: { backgroundColor: colors.gold, borderColor: colors.gold },
  markText: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  markTextDone: { color: '#dcfce7' },
  markTextCurrent: { color: '#1a1408' },
  stepLabel: { color: colors.muted, fontSize: 10, fontWeight: '600', marginLeft: 6 },
  stepLabelDone: { color: '#86efac' },
  stepLabelCurrent: { color: colors.gold },
  chev: { color: '#3d4458', marginHorizontal: 7, fontSize: 13 },
  web: { flex: 1, backgroundColor: '#0f172a' },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: colors.bgChrome,
  },
  status: { color: colors.muted, fontSize: 11, marginBottom: 6 },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 6 },
  split: { flex: 1, flexDirection: 'row' },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  btnPrimary: { backgroundColor: colors.primary, borderColor: 'rgba(59, 130, 246, 0.85)' },
  btnAutofill: { backgroundColor: colors.autofill, borderColor: colors.autofillBorder },
  btnDanger: { backgroundColor: colors.danger, borderColor: 'rgba(220, 38, 38, 0.9)' },
  btnStage: { flex: 1, backgroundColor: '#1f2937', borderColor: '#374151', paddingVertical: 8 },
  splitMain: { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  splitArrow: {
    width: 32,
    paddingHorizontal: 0,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderLeftColor: 'rgba(255,255,255,0.12)',
  },
  splitMenu: { flexDirection: 'row', gap: 4, marginTop: 8 },
});
