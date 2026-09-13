import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { fetchMyNotifications } from '@/api/notifications';
import { useAuthStore } from '@/auth/store';
import { CountyPickerSheet } from '@/components/CountyPickerSheet';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

// Contextual app header (spec §9) — location selector + Search/Messages/
// Notifications/Profile icon actions. Messages dropped off the bottom tab
// bar in favour of Circles (spec nav, §17); this header is where it — and
// the not-yet-tabbed Notifications/Profile screens — become reachable.
export function AppHeader({ greeting }: { greeting?: string }) {
  const county = useOnboardingStore((state) => state.homeCounty);
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const locationSheetRef = useRef<BottomSheetModal>(null);

  // Shares the ['my-notifications'] query key with notifications.tsx —
  // TanStack dedupes/caches this, so mounting the header doesn't add a
  // second network call on screens that already fetch it.
  const { data: notifications } = useQuery({ queryKey: ['my-notifications'], queryFn: fetchMyNotifications, enabled: signedIn });
  const hasUnread = (notifications ?? []).some((n) => !n.read);

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
        {greeting && (
          <ThemedText type="eyebrow" style={{ marginBottom: 2 }}>
            {greeting}
          </ThemedText>
        )}
        <Pressable onPress={() => locationSheetRef.current?.present()} style={styles.locationRow}>
          <ThemedText type="cardHeading">{county ?? 'Set location'}</ThemedText>
          <Ionicons name="chevron-down" size={18} style={{ marginLeft: 2 }} />
        </Pressable>
      </View>

      <View style={styles.actions}>
        <HeaderIcon name="search-outline" label="Search" onPress={() => router.push('/search')} />
        <HeaderIcon name="chatbubble-outline" label="Messages" onPress={() => router.push('/messages')} />
        <HeaderIcon name="notifications-outline" label="Notifications" showDot={hasUnread} onPress={() => router.push('/notifications')} />
        <HeaderIcon name="person-circle-outline" label="Profile" onPress={() => router.push('/profile')} />
      </View>

      <CountyPickerSheet ref={locationSheetRef} />
    </View>
  );
}

function HeaderIcon({
  name,
  label,
  onPress,
  showDot,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  showDot?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={styles.iconButton}>
      <Ionicons name={name} size={24} color={theme.text} />
      {showDot && <View style={[styles.dot, { backgroundColor: theme.accent, borderColor: theme.backgroundElement }]} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 9,
    height: 9,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
});
