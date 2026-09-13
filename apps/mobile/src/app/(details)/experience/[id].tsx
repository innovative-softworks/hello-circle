import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchExperience } from '@/api/experiences';
import { Chip } from '@/components/Chip';
import { DetailMap } from '@/components/detail/DetailMap';
import { HeroIconButton, ImmersiveHero } from '@/components/detail/ImmersiveHero';
import { StickyPriceRail } from '@/components/detail/StickyPriceRail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatPriceCents } from '@/lib/format';

// Adventures & Experiences — mobile had zero screens for this 3rd listing
// type; web has full detail + booking pages. Session picking happens right
// here (chips), rather than a separate step — Experience.sessions already
// comes back with the detail fetch, so there's nothing to gain from a
// dedicated picker screen the way room-booking's multi-room case needed one.
export default function ExperienceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: experience } = useQuery({ queryKey: ['experience', id], queryFn: () => fetchExperience(id) });
  const [sessionId, setSessionId] = useState<string | null>(null);

  function handleShare() {
    if (!experience) return;
    router.push({
      pathname: '/(modals)/share',
      params: {
        title: 'Share this experience',
        text: `${experience.title} in ${experience.area}, ${experience.county}, via HelloCircle: https://hellocircle.ie/${experience.kind === 'adventure' ? 'adventures' : 'experiences'}/${experience.id}`,
        link: `https://hellocircle.ie/${experience.kind === 'adventure' ? 'adventures' : 'experiences'}/${experience.id}`,
      },
    });
  }

  function handleDirections() {
    if (!experience) return;
    const query = encodeURIComponent([experience.meetingPoint, experience.area, experience.county].filter(Boolean).join(', '));
    Linking.openURL(`https://maps.google.com/?q=${query}`);
  }

  if (!experience) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const openSessions = experience.sessions.filter((s) => s.spotsLeft > 0);
  const selectedSession = experience.sessions.find((s) => s.id === sessionId) ?? null;

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView>
          <ImmersiveHero
            imageUrl={experience.imageUrl}
            placeholderIcon="compass-outline"
            onBack={() => router.back()}
            actions={<HeroIconButton onPress={handleShare} icon="share-outline" label="Share" />}
          />
          <View style={{ padding: Spacing.four, gap: Spacing.three }}>
            <View style={{ gap: 4 }}>
              <ThemedText type="eyebrow">{experience.kind === 'adventure' ? 'Adventure' : 'Experience'}</ThemedText>
              <ThemedText type="editorial">{experience.title}</ThemedText>
              <ThemedText themeColor="textSecondary">
                {experience.area}, {experience.county}
                {experience.difficulty ? ` · ${experience.difficulty}` : ''} · {Math.round(experience.durationMinutes / 60) || experience.durationMinutes}
                {experience.durationMinutes >= 60 ? 'h' : 'm'}
                {experience.distanceKm !== null ? ` · ${experience.distanceKm}km` : ''}
              </ThemedText>
            </View>

            <ThemedText>{experience.description || experience.blurb}</ThemedText>

            {experience.itinerary && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Itinerary</ThemedText>
                <ThemedText themeColor="textSecondary">{experience.itinerary}</ThemedText>
              </View>
            )}

            <View style={{ gap: Spacing.two }}>
              <ThemedText type="sectionHeading">Choose a session</ThemedText>
              {openSessions.length === 0 ? (
                <ThemedText themeColor="textSecondary">No upcoming sessions open right now.</ThemedText>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
                  {openSessions.map((session) => (
                    <Chip
                      key={session.id}
                      label={`${session.date} · ${session.time}`}
                      selected={sessionId === session.id}
                      onPress={() => setSessionId(sessionId === session.id ? null : session.id)}
                    />
                  ))}
                </ScrollView>
              )}
              {selectedSession && (
                <ThemedText themeColor="textSecondary">{selectedSession.spotsLeft} spots left on this session</ThemedText>
              )}
            </View>

            {experience.equipmentProvided && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Equipment provided</ThemedText>
                <ThemedText themeColor="textSecondary">{experience.equipmentProvided}</ThemedText>
              </View>
            )}
            {experience.equipmentRequired && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">What to bring</ThemedText>
                <ThemedText themeColor="textSecondary">{experience.equipmentRequired}</ThemedText>
              </View>
            )}
            {experience.fitnessRequirements && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Fitness requirements</ThemedText>
                <ThemedText themeColor="textSecondary">{experience.fitnessRequirements}</ThemedText>
              </View>
            )}
            {experience.eligibility && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Eligibility</ThemedText>
                <ThemedText themeColor="textSecondary">{experience.eligibility}</ThemedText>
              </View>
            )}
            {experience.safetyInfo && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Safety</ThemedText>
                <ThemedText themeColor="textSecondary">{experience.safetyInfo}</ThemedText>
              </View>
            )}
            {experience.weatherPolicy && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Weather policy</ThemedText>
                <ThemedText themeColor="textSecondary">{experience.weatherPolicy}</ThemedText>
              </View>
            )}
            {experience.cancellationTerms && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Cancellation</ThemedText>
                <ThemedText themeColor="textSecondary">{experience.cancellationTerms}</ThemedText>
              </View>
            )}

            <View style={{ gap: 4 }}>
              <ThemedText type="sectionHeading">Meeting point</ThemedText>
              <ThemedText themeColor="textSecondary">{experience.meetingPoint}</ThemedText>
              <ThemedText onPress={handleDirections} type="smallBold" themeColor="primary">
                Get directions →
              </ThemedText>
              {experience.lat !== null && experience.lng !== null && <DetailMap lat={experience.lat} lng={experience.lng} title={experience.title} />}
            </View>

            {experience.transportInfo && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Getting there</ThemedText>
                <ThemedText themeColor="textSecondary">{experience.transportInfo}</ThemedText>
              </View>
            )}
          </View>
        </ScrollView>
        <StickyPriceRail
          priceLabel={`${formatPriceCents(experience.priceCents)} / person`}
          ctaLabel={selectedSession ? 'Book' : 'Choose a session'}
          onPress={
            selectedSession
              ? () => router.push({ pathname: '/experience-booking/[experienceId]/details', params: { experienceId: experience.id, sessionId: selectedSession.id } })
              : undefined
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}
