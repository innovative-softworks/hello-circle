import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchFavourites } from '@/api/favourites';
import { fetchMyFollows } from '@/api/follow';
import { fetchMyCircles } from '@/api/circles';
import { fetchMyResidentProfile } from '@/api/residents';
import { useAuthStore } from '@/auth/store';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// spec §23 — kept human rather than gamified: name/location/short identity,
// three honest counts, and a way into what those counts mean. No badges/
// points, no photo upload yet (no API for it), so no photographic header.
export default function ProfileScreen() {
  const theme = useTheme();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const email = useAuthStore((state) => state.email);

  const profileQuery = useQuery({ queryKey: ['my-resident-profile'], queryFn: fetchMyResidentProfile, enabled: signedIn });
  const circlesQuery = useQuery({ queryKey: ['my-circles'], queryFn: fetchMyCircles, enabled: signedIn });
  const favouritesQuery = useQuery({ queryKey: ['favourites'], queryFn: fetchFavourites, enabled: signedIn });
  const followsQuery = useQuery({ queryKey: ['my-follows'], queryFn: fetchMyFollows, enabled: signedIn });

  if (!signedIn) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <ScreenHeader title="Profile" />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
            <ThemedText themeColor="textSecondary">Sign in to see your profile.</ThemedText>
            <Button label="Sign in" onPress={() => router.push('/auth/sign-in')} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const resident = profileQuery.data?.resident;

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenHeader title="Profile" />
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.four }}>
          <View style={{ gap: Spacing.half }}>
            <View style={{ marginBottom: Spacing.two }}>
              <Avatar name={resident?.name ?? email ?? '?'} size={72} />
            </View>
            <ThemedText type="hero">{resident?.name ?? 'Your profile'}</ThemedText>
            <ThemedText themeColor="textSecondary">{resident?.homeCounty ?? email}</ThemedText>
          </View>

          <View style={styles.statsRow}>
            <Pressable style={styles.stat} onPress={() => router.push('/circles')}>
              <ThemedText type="cardHeading">{circlesQuery.data?.length ?? 0}</ThemedText>
              <ThemedText type="metadata">Circles</ThemedText>
            </Pressable>
            <Pressable style={styles.stat} onPress={() => router.push('/saved')}>
              <ThemedText type="cardHeading">{favouritesQuery.data?.length ?? 0}</ThemedText>
              <ThemedText type="metadata">Saved</ThemedText>
            </Pressable>
            <Pressable style={styles.stat} onPress={() => router.push('/following')}>
              <ThemedText type="cardHeading">{followsQuery.data?.length ?? 0}</ThemedText>
              <ThemedText type="metadata">Following</ThemedText>
            </Pressable>
          </View>

          <Pressable onPress={() => router.push('/edit-profile')} style={[styles.linkRow, { borderColor: theme.border }]}>
            <ThemedText type="cardHeading">Edit Profile</ThemedText>
            <ThemedText themeColor="textSecondary">→</ThemedText>
          </Pressable>

          <Pressable onPress={() => router.push('/settings')} style={[styles.linkRow, { borderColor: theme.border }]}>
            <ThemedText type="cardHeading">Settings</ThemedText>
            <ThemedText themeColor="textSecondary">→</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.three,
  },
  stat: {
    alignItems: 'center',
    gap: 2,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
});
