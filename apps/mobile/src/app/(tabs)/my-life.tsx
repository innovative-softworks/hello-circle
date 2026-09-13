import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMyCircles } from '@/api/circles';
import { fetchMyExperienceBookings } from '@/api/experiences';
import { fetchFavourites } from '@/api/favourites';
import { fetchMyGames } from '@/api/games';
import { fetchMyParticipation } from '@/api/participation';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { CirclesSection } from '@/components/my-life/CirclesSection';
import { ExperienceBookingsSection } from '@/components/my-life/ExperienceBookingsSection';
import { HostingSection } from '@/components/my-life/HostingSection';
import { ParticipationRow } from '@/components/my-life/ParticipationRow';
import { ParticipationSection } from '@/components/my-life/ParticipationSection';
import { SavedPreview } from '@/components/my-life/SavedPreview';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { splitUpcomingHistory } from '@/lib/participationSplit';

// spec §20/§37 — "My Life" as a visual record of real-world activity, not a
// dashboard: a Next Up highlight, a real "plans this month" count (computed
// client-side from ParticipationEntry — no resident-month-summary endpoint
// exists), My Schedule, Your Circles, Saved for later, Hosting, and Past
// Experiences. "Memories" has no backing feature/API yet — shown disabled
// rather than hidden or faked, same convention as start-sheet.tsx's unbuilt
// rows. No "new people met" stat — no field anywhere backs that count.
export default function MyLifeScreen() {
  const { email, status, signOut } = useAuthStore();
  const signedIn = status === 'signedIn';

  const { data } = useQuery({ queryKey: ['my-participation'], queryFn: fetchMyParticipation, enabled: signedIn });
  const { data: hostedGames } = useQuery({ queryKey: ['my-games-hosted'], queryFn: () => fetchMyGames({ hostedOnly: true }), enabled: signedIn });
  const { data: circles } = useQuery({ queryKey: ['my-circles'], queryFn: fetchMyCircles, enabled: signedIn });
  const { data: favourites } = useQuery({ queryKey: ['favourites'], queryFn: fetchFavourites, enabled: signedIn });
  const { data: experienceBookings } = useQuery({ queryKey: ['my-experience-bookings'], queryFn: fetchMyExperienceBookings, enabled: signedIn });

  if (!signedIn) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText type="pageHeading">My Life</ThemedText>
          <ThemedText themeColor="textSecondary">Sign in to see your bookings, Circles, and games.</ThemedText>
          <Button label="Sign in" onPress={() => router.push('/auth/sign-in')} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const { upcoming, history } = splitUpcomingHistory(data ?? [], todayIso);
  const nextUp = upcoming[0];

  const currentYearMonth = todayIso.slice(0, 7);
  const plansThisMonth = (data ?? []).filter((entry) => entry.date.startsWith(currentYearMonth)).length;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ gap: Spacing.four, padding: Spacing.four }}>
          <View>
            <ThemedText type="pageHeading">My Life</ThemedText>
            <ThemedText themeColor="textSecondary">Your calendar. Your community. Your story.</ThemedText>
          </View>

          <View>
            <ThemedText type="eyebrow">This month</ThemedText>
            <ThemedText type="editorial">
              {plansThisMonth > 0
                ? `You've made ${plansThisMonth} plan${plansThisMonth === 1 ? '' : 's'}\nthis month.`
                : "Nothing planned\nthis month yet."}
            </ThemedText>
          </View>

          {nextUp && (
            <View>
              <ThemedText type="eyebrow" style={{ marginBottom: Spacing.one }}>
                Next up
              </ThemedText>
              <ParticipationRow entry={nextUp} />
            </View>
          )}

          <ParticipationSection title="My Schedule" entries={upcoming} />

          <CirclesSection circles={circles ?? []} />
          <ExperienceBookingsSection bookings={experienceBookings ?? []} />
          <SavedPreview favourites={favourites ?? []} />

          <View style={styles.linksGrid}>
            <QuickLink label="Following" onPress={() => router.push('/following')} />
            <QuickLink label="Memories" disabled />
          </View>

          <HostingSection games={hostedGames ?? []} />
          <ParticipationSection title="Past Experiences" entries={history} />

          {!upcoming.length && !history.length && !hostedGames?.length && !experienceBookings?.length && (
            <ThemedText themeColor="textSecondary">Nothing here yet — join or book something to see it show up.</ThemedText>
          )}

          <ThemedText themeColor="textSecondary">Signed in as {email}</ThemedText>
          <Button label="Sign out" onPress={signOut} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function QuickLink({ label, onPress, disabled }: { label: string; onPress?: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.linkTile, { borderColor: theme.border }]}>
      <ThemedText themeColor={disabled ? 'textSecondary' : 'text'}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  linksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  linkTile: {
    flexGrow: 1,
    minWidth: '45%',
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    alignItems: 'center',
  },
});
