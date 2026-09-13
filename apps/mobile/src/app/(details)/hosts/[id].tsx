import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchHostProfile } from '@/api/residents';
import { Avatar } from '@/components/Avatar';
import { FollowButton } from '@/components/detail/FollowButton';
import { Reviews } from '@/components/detail/Reviews';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Public profile for a resident who has been admin-approved as a host
// (badge-only trust tier — see Game/Circle's own hostVerified field).
// Ports web's HostProfile.tsx. Distinct from a vendor's ProviderProfile
// (centre/club) — that's a separate, larger web page not ported here.
export default function HostProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: host } = useQuery({ queryKey: ['host-profile', id], queryFn: () => fetchHostProfile(id) });

  if (!host) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const screenPath = `/(details)/hosts/${id}`;

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: host.name }} />
      <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
        <Avatar name={host.name} size={72} />

        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <ThemedText type="pageHeading">{host.name}</ThemedText>
            <ThemedText themeColor="primary" type="metadata">
              Verified Host
            </ThemedText>
          </View>
          <FollowButton followedType="host" followedId={id} initialFollowing={host.isFollowing} screenPath={screenPath} />
        </View>

        {host.bio.length > 0 && <ThemedText>{host.bio}</ThemedText>}

        <View style={styles.statsRow}>
          <Stat label="Games hosted" value={String(host.gamesHostedTotal)} />
          <Stat label="Followers" value={String(host.followerCount)} />
          {host.reviews > 0 && <Stat label="Rating" value={`★ ${host.rating.toFixed(1)}`} />}
        </View>

        {host.upcomingGames.length > 0 && (
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="sectionHeading">Upcoming games</ThemedText>
            {host.upcomingGames.map((game) => (
              <Pressable key={game.id} onPress={() => router.push(`/(details)/game/${game.id}`)}>
                <ThemedText themeColor="primary">
                  {game.activityLabel} · {game.date} {game.time}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        )}

        {host.circles.length > 0 && (
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="sectionHeading">Circles started</ThemedText>
            {host.circles.map((circle) => (
              <Pressable key={circle.id} onPress={() => router.push(`/(details)/circle/${circle.id}`)}>
                <ThemedText themeColor="primary">
                  {circle.name} · {circle.activityLabel}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        )}

        <Reviews listingType="host" listingId={id} />
      </ScrollView>
    </ThemedView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <ThemedText type="cardHeading">{value}</ThemedText>
      <ThemedText type="metadata">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.five,
  },
});
