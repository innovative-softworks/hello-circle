import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMyNotifications, markNotificationRead, type ResidentNotification } from '@/api/notifications';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// spec §22 — categorized, actionable notifications. `kind` values come from
// server/src/notifications.ts's writers (booking/registration/game/circle/
// program/pass confirmations, join requests, invitations, etc.) — grouped
// here into the spec's four broad filters rather than one per kind.
type FilterKey = 'all' | 'events' | 'circles' | 'bookings';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'events', label: 'Events' },
  { key: 'circles', label: 'Circles' },
  { key: 'bookings', label: 'Bookings' },
];

function matchesFilter(kind: string, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'circles') return kind.includes('circle');
  if (filter === 'bookings') return kind.includes('booking') || kind.includes('registration') || kind.includes('pass');
  if (filter === 'events') return kind.includes('game') || kind.includes('program');
  return true;
}

function destinationFor(n: ResidentNotification): string | null {
  if (n.ref) return `/(details)/receipt/${n.ref}`;
  if (n.listingType === 'circle' && n.listingId) return `/(details)/circle/${n.listingId}`;
  if (n.listingType === 'game' && n.listingId) return `/(details)/game/${n.listingId}`;
  if (n.listingType === 'centre' && n.listingId) return `/(details)/centre/${n.listingId}`;
  if (n.listingType === 'club' && n.listingId) return `/(details)/club/${n.listingId}`;
  return null;
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const [filter, setFilter] = useState<FilterKey>('all');

  const { data, isLoading } = useQuery({ queryKey: ['my-notifications'], queryFn: fetchMyNotifications, enabled: signedIn });

  async function handlePress(n: ResidentNotification) {
    if (!n.read) {
      markNotificationRead(n.id)
        .then(() => queryClient.invalidateQueries({ queryKey: ['my-notifications'] }))
        .catch(() => undefined);
    }
    const destination = destinationFor(n);
    if (destination) router.push(destination as never);
  }

  if (!signedIn) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <ScreenHeader title="Notifications" />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
            <ThemedText themeColor="textSecondary">Sign in to see updates on your bookings, Circles, and games.</ThemedText>
            <Button label="Sign in" onPress={() => router.push('/auth/sign-in')} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const notifications = (data ?? []).filter((n) => matchesFilter(n.kind, filter));

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenHeader title="Notifications" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three }}>
          {FILTERS.map((f) => (
            <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </ScrollView>

        {!isLoading && notifications.length === 0 ? (
          <EmptyState icon="checkmark-circle-outline" title="You're all caught up." description="Nothing new right now." />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: Spacing.four }}>
            {notifications.map((n) => (
              <Pressable key={n.id} onPress={() => handlePress(n)} style={[styles.row, { borderColor: theme.border }]}>
                {!n.read && <View style={[styles.dot, { backgroundColor: theme.primary }]} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText type="cardHeading">{n.title}</ThemedText>
                  <ThemedText themeColor="textSecondary">{n.body}</ThemedText>
                  {destinationFor(n) && <ThemedText themeColor="primary">VIEW →</ThemedText>}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
    marginTop: Spacing.two,
  },
});
