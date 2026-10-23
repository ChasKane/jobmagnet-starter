import { useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { colors } from '../theme';

const STATUSES = [
  { id: 'open', label: 'Open' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'passed', label: 'Passed' },
  { id: 'all', label: 'All' },
];

function pick(title, options, current, onPick) {
  Alert.alert(title, undefined, [
    ...options.map((opt) => ({
      text: opt.label + (opt.id === current ? ' ✓' : ''),
      onPress: () => onPick(opt.id),
    })),
    { text: 'Cancel', style: 'cancel' },
  ]);
}

function logoLetter(item) {
  const name = String(item.company || item.name || item.title || '?').trim();
  return (name[0] || '?').toUpperCase();
}

function Row({ item, active, onOpen, onPass, onAutofill }) {
  const submitted = item.bucket === 'submitted' || item.status === 'submitted';
  return (
    <Swipeable
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.under}>
          <Text style={styles.underText}>Pass</Text>
        </View>
      )}
      onSwipeableOpen={(dir) => {
        if (dir === 'right') onPass(item);
      }}
    >
      <View style={[styles.tabRow, active && styles.tabRowActive]}>
        <Pressable onPress={() => onOpen(item)} style={styles.tab}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>{logoLetter(item)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.name, submitted && styles.nameSubmitted]} numberOfLines={1}>
              {item.company || item.name || 'Job'}
            </Text>
            <Text style={styles.role} numberOfLines={1}>
              {item.title || item.url}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => onAutofill(item)}
          disabled={submitted}
          style={styles.bolt}
        >
          <Text style={styles.boltText}>{submitted ? '—' : '⚡'}</Text>
        </Pressable>
      </View>
    </Swipeable>
  );
}

export default function QueueScreen({
  jobs,
  totals,
  filter,
  onFilter,
  onOpen,
  onPass,
  onAutofill,
  onIngest,
  onSettings,
  url,
  onUrlChange,
  onUrlSubmit,
  canBack,
  canForward,
  onBack,
  onForward,
  onReload,
  activeId,
  mail,
  onMail,
  notices,
  onNotice,
}) {
  const [bellOpen, setBellOpen] = useState(false);
  const unread = (notices || []).length;
  const statusLabel = (STATUSES.find((s) => s.id === filter.status) || STATUSES[0]).label;
  const yoes = ['all', ...new Set((jobs || []).map((j) => j.yoe).filter(Boolean).map(String))];
  const levels = ['all', ...new Set((jobs || []).map((j) => j.level).filter(Boolean).map(String))];

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>JobMagnet</Text>
          <View style={styles.brandMeta}>
            <View style={styles.lifetime}>
              <Text style={styles.lifetimeText}>{totals.submitted || 0}</Text>
            </View>
            <Pressable
              onPress={() => setBellOpen(true)}
              hitSlop={8}
              style={styles.gear}
              accessibilityLabel={unread ? `${unread} unread notices` : 'Notices'}
            >
              <Text style={styles.gearGlyph}>🔔</Text>
              {unread ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable onPress={onSettings} hitSlop={8} style={styles.gear} accessibilityLabel="Settings">
              <Text style={styles.gearGlyph}>⚙</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.navBar}>
          <Pressable onPress={onBack} disabled={!canBack} style={[styles.navBtn, !canBack && styles.navOff]}>
            <Text style={styles.navGlyph}>←</Text>
          </Pressable>
          <Pressable onPress={onForward} disabled={!canForward} style={[styles.navBtn, !canForward && styles.navOff]}>
            <Text style={styles.navGlyph}>→</Text>
          </Pressable>
          <Pressable onPress={onReload} style={styles.navBtn}>
            <Text style={styles.navGlyph}>↻</Text>
          </Pressable>
        </View>
        <TextInput
          value={url}
          onChangeText={onUrlChange}
          onSubmitEditing={onUrlSubmit}
          placeholder="Search or enter address"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          style={styles.url}
        />
        <TextInput
          value={filter.q}
          onChangeText={(q) => onFilter({ ...filter, q })}
          placeholder="Search company or title…"
          placeholderTextColor={colors.muted}
          style={styles.search}
        />
        <View style={styles.filterRow}>
          <Pressable
            style={styles.filter}
            onPress={() =>
              pick('Status', STATUSES, filter.status, (status) => onFilter({ ...filter, status }))
            }
          >
            <Text style={styles.filterLabel}>Status</Text>
            <Text style={styles.filterValue}>{statusLabel}</Text>
          </Pressable>
          <Pressable
            style={styles.filter}
            onPress={() =>
              pick(
                'YoE',
                yoes.map((id) => ({ id, label: id === 'all' ? 'All' : id })),
                filter.yoe || 'all',
                (yoe) => onFilter({ ...filter, yoe })
              )
            }
          >
            <Text style={styles.filterLabel}>YoE</Text>
            <Text style={styles.filterValue}>{filter.yoe && filter.yoe !== 'all' ? filter.yoe : 'All'}</Text>
          </Pressable>
          <Pressable
            style={styles.filter}
            onPress={() =>
              pick(
                'Level',
                levels.map((id) => ({ id, label: id === 'all' ? 'All' : id })),
                filter.level || 'all',
                (level) => onFilter({ ...filter, level })
              )
            }
          >
            <Text style={styles.filterLabel}>Level</Text>
            <Text style={styles.filterValue}>{filter.level && filter.level !== 'all' ? filter.level : 'All'}</Text>
          </Pressable>
        </View>
        <Text style={styles.count}>
          {jobs.length} job{jobs.length === 1 ? '' : 's'}
          {mail && mail.pending ? ` · ${mail.pending} mail to review` : ''}
          {mail && mail.connected && mail.email ? ` · ${mail.email}` : ''}
        </Text>
        <Pressable onPress={onIngest} style={styles.ingest}>
          <Text style={styles.ingestText}>Ingest</Text>
        </Pressable>
        <Pressable onPress={onMail} style={[styles.ingest, { marginTop: 6 }]}>
          <Text style={styles.ingestText}>{mail && mail.connected ? 'Gmail' : 'Sign in to Gmail'}</Text>
        </Pressable>
      </View>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 8, paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Row
            item={item}
            active={item.id === activeId}
            onOpen={onOpen}
            onPass={onPass}
            onAutofill={onAutofill}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>No jobs in this filter. Ingest a URL.</Text>}
      />
      <Modal visible={bellOpen} transparent animationType="fade" onRequestClose={() => setBellOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setBellOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Notices</Text>
              <Pressable onPress={() => setBellOpen(false)}>
                <Text style={styles.sheetClose}>Close</Text>
              </Pressable>
            </View>
            {unread ? (
              <ScrollView>
              {(notices || []).map((n) => (
                <Pressable
                  key={`${n.key}-${n.mailId || n.at}`}
                  onPress={() => {
                    setBellOpen(false);
                    onNotice && onNotice(n);
                  }}
                  style={styles.notice}
                >
                  <Text style={styles.noticeCo} numberOfLines={1}>
                    {n.company || 'Mail'}
                    {n.title ? ` · ${n.title}` : ''}
                  </Text>
                  <Text style={styles.noticeText} numberOfLines={3}>
                    {n.text}
                  </Text>
                </Pressable>
              ))}
              </ScrollView>
            ) : (
              <Text style={styles.empty}>Nothing waiting. Unsure recruiting mail lands here.</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgChrome,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: colors.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  brandMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lifetime: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  lifetimeText: { color: colors.gold, fontSize: 11, fontWeight: '700' },
  gear: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  gearGlyph: { color: colors.muted, fontSize: 14 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 8, fontWeight: '700' },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(8, 10, 14, 0.55)',
    justifyContent: 'flex-start',
    paddingTop: 56,
    paddingHorizontal: 16,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    maxHeight: '70%',
  },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sheetTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  sheetClose: { color: colors.muted, fontSize: 12 },
  notice: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  noticeCo: { color: colors.gold, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  noticeText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  navBar: { flexDirection: 'row', gap: 4, marginTop: 10 },
  navBtn: {
    width: 36,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navOff: { opacity: 0.35 },
  navGlyph: { color: colors.text, fontSize: 14 },
  url: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 8,
    fontSize: 12,
  },
  search: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  filterRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  filter: { flex: 1 },
  filterLabel: {
    color: colors.muted,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  filterValue: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 11,
  },
  count: { color: colors.muted, fontSize: 10, marginTop: 8, marginBottom: 8 },
  ingest: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 7,
    paddingVertical: 10,
    alignItems: 'center',
  },
  ingestText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 8,
    marginBottom: 4,
  },
  tabRowActive: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(110, 168, 254, 0.35)',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 8,
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.bgActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#c5cad6', fontSize: 10, fontWeight: '700' },
  name: { color: colors.text, fontSize: 13, fontWeight: '700' },
  nameSubmitted: { color: '#b7d4ff' },
  role: { color: colors.muted, fontSize: 11, marginTop: 1 },
  bolt: {
    width: 28,
    marginVertical: 6,
    marginRight: 4,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boltText: { color: colors.muted, fontSize: 12 },
  under: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    borderRadius: 8,
    marginLeft: 4,
  },
  underText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  empty: { color: colors.muted, marginTop: 24, textAlign: 'center', fontSize: 12 },
});
