// Headless tabs (expo-router/ui) rather than the classic <Tabs> from
// 'expo-router' or the template's NativeTabs — chosen specifically because
// TabTrigger's onPress fires before its internal navigation and honors
// event.preventDefault(), which is exactly what "Start" needs: it must
// never navigate to its own screen, only ever open the action-sheet modal
// (master prompt §6). Confirmed against this exact installed expo-router
// version's source (node_modules/expo-router/build/ui/TabTrigger.js) before
// relying on it. Focus state is read via usePathname() (a confirmed, plain
// expo-router hook) rather than any render-prop on TabTrigger's children —
// TabTriggerProps only types `children` as plain ReactNode, so a per-trigger
// isFocused render-prop isn't part of its actual API.
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import type { GestureResponderEvent } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBarIcon } from '@/components/TabBarIcon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function TabLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  function openStartSheet(e: GestureResponderEvent) {
    e.preventDefault();
    router.push('/(modals)/start-sheet');
  }

  return (
    <Tabs>
      {/* TabSlot must be wrapped in an explicit flex:1 View, not rendered
          bare — react-native-screens' native ScreenContainer/Screen (which
          TabSlot renders through) resolve their own `height: '100%'`
          against this wrapper's Yoga-measured height. Without it, the
          native Screen instead fills the whole Tabs root, rendering
          full-bleed and covering TabList entirely regardless of TabList's
          own layout — confirmed against Expo's own custom-tabs docs
          (docs.expo.dev/router/advanced/custom-tabs), which show this exact
          wrapper as the documented pattern. */}
      <View style={{ flex: 1 }}>
        <TabSlot />
      </View>
      <TabList
        style={[
          styles.tabList,
          { borderTopColor: theme.border, backgroundColor: theme.backgroundElement, paddingBottom: insets.bottom },
        ]}>
        <TabTrigger name="home" href="/" style={{ flex: 1 }}>
          <TabBarIcon name="home-outline" focusedName="home" label="Home" focused={pathname === '/'} />
        </TabTrigger>
        <TabTrigger name="explore" href="/explore" style={{ flex: 1 }}>
          <TabBarIcon name="compass-outline" focusedName="compass" label="Explore" focused={pathname === '/explore'} />
        </TabTrigger>
        <TabTrigger name="start" href="/start" onPress={openStartSheet} style={{ flex: 1 }}>
          <CreateTabButton theme={theme} />
        </TabTrigger>
        <TabTrigger name="circles" href="/circles" style={{ flex: 1 }}>
          <TabBarIcon name="people-outline" focusedName="people" label="Circles" focused={pathname === '/circles'} />
        </TabTrigger>
        <TabTrigger name="my-life" href="/my-life" style={{ flex: 1 }}>
          <TabBarIcon name="calendar-outline" focusedName="calendar" label="My Life" focused={pathname === '/my-life'} />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

// Distinguished centre action (spec §11/§16) — a filled circular badge
// instead of a plain glyph, still sized to fit the same fixed-height row as
// every other tab (see TAB_BAR_HEIGHT's own comment on why that height is
// fixed) rather than floating/overflowing it, which risks reintroducing the
// exact clipping bug that fix was written for.
function CreateTabButton({ theme }: { theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.createContainer}>
      <View style={[styles.createBadge, { backgroundColor: theme.primary }]}>
        <Ionicons name="add" size={22} color="#fff" />
      </View>
      <Text style={[styles.createLabel, { color: theme.textSecondary }]}>Start</Text>
    </View>
  );
}

// Standard iOS tab bar content height (excludes the home-indicator safe
// area, added separately below via insets.bottom).
const TAB_BAR_HEIGHT = 56;

const styles = StyleSheet.create({
  tabList: {
    flexDirection: 'row',
    borderTopWidth: 1,
    // TabList has no intrinsic height of its own — it was relying on
    // TabTrigger/TabBarIcon's content to auto-size it, but TabBarIcon's
    // container uses `flex: 1` (see components/TabBarIcon.tsx), which only
    // resolves against a parent with a *definite* height. With none of
    // TabList → TabTrigger → TabBarIcon providing one, the whole chain
    // collapsed to zero height — confirmed by forcing an explicit height +
    // bright background here and seeing the bar actually appear. An
    // explicit height breaks that circular auto-sizing dependency.
    height: TAB_BAR_HEIGHT,
  },
  createContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 2,
    flex: 1,
  },
  createBadge: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
});
