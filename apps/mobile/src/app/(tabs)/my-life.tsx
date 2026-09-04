import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMyGames } from '@/api/games';
import { fetchMyParticipation } from '@/api/participation';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { HostingSection } from '@/components/my-life/HostingSection';
import { ParticipationSection } from '@/components/my-life/ParticipationSection';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { splitUpcomingHistory } from '@/lib/participationSplit';

export default function MyLifeScreen() {
  const { email, status, signOut } = useAuthStore();
  const signedIn = status === 'signedIn';

  const { data } = useQuery({ queryKey: ['my-participation'], queryFn: fetchMyParticipation, enabled: signedIn });
  const { data: hostedGames } = useQuery({ queryKey: ['my-games-hosted'], queryFn: () => fetchMyGames({ hostedOnly: true }), enabled: signedIn });

  if (!signedIn) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText type="subtitle">My Life</ThemedText>
          <ThemedText themeColor="textSecondary">Sign in to see your bookings, Circles, and games.</ThemedText>
          <Button label="Sign in" onPress={() => router.push('/auth/sign-in')} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const { upcoming, history } = splitUpcomingHistory(data ?? [], todayIso);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ gap: Spacing.four, padding: Spacing.four }}>
          <ThemedText type="title">My Life</ThemedText>
          <ThemedText themeColor="textSecondary">Signed in as {email}</ThemedText>

          <ParticipationSection title="Upcoming" entries={upcoming} />
          <ParticipationSection title="History" entries={history} />
          <HostingSection games={hostedGames ?? []} />

          {!upcoming.length && !history.length && !hostedGames?.length && (
            <ThemedText themeColor="textSecondary">Nothing here yet — join or book something to see it show up.</ThemedText>
          )}

          <Button label="Sign out" onPress={signOut} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
