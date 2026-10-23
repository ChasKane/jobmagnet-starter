import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

const TABS = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'apply', label: 'Apply' },
  { id: 'chat', label: 'Chat' },
];

export default function ShellTabs({ pane, reviewCount, onPane }) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const on = pane === tab.id;
        return (
          <Pressable key={tab.id} onPress={() => onPane(tab.id)} style={[styles.tab, on && styles.tabOn]}>
            <Text style={[styles.label, on && styles.labelOn]}>{tab.label}</Text>
            {tab.id === 'chat' && reviewCount ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{reviewCount > 9 ? '9+' : reviewCount}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgChrome,
    paddingBottom: 8,
    minHeight: 52,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabOn: {
    borderBottomColor: colors.primary,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  labelOn: { color: colors.text },
  badge: {
    position: 'absolute',
    top: 6,
    right: '28%',
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 99,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
});
