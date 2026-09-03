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
import { router, usePathname } from 'expo-router';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import type { GestureResponderEvent } from 'react-native';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBarIcon } from '@/components/TabBarIcon';
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
      <TabSlot />
      <TabList
        style={[
          styles.tabList,
          { borderTopColor: theme.border, backgroundColor: theme.backgroundElement, paddingBottom: insets.bottom },
        ]}>
        <TabTrigger name="home" href="/">
          <TabBarIcon glyph="⌂" label="Home" focused={pathname === '/'} />
        </TabTrigger>
        <TabTrigger name="explore" href="/explore">
          <TabBarIcon glyph="⌕" label="Explore" focused={pathname === '/explore'} />
        </TabTrigger>
        <TabTrigger name="start" href="/start" onPress={openStartSheet}>
          <TabBarIcon glyph="+" label="Start" focused={false} />
        </TabTrigger>
        <TabTrigger name="messages" href="/messages">
          <TabBarIcon glyph="✉" label="Messages" focused={pathname === '/messages'} />
        </TabTrigger>
        <TabTrigger name="my-life" href="/my-life">
          <TabBarIcon glyph="◎" label="My Life" focused={pathname === '/my-life'} />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabList: {
    flexDirection: 'row',
    borderTopWidth: 1,
  },
});
