import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchProgram } from '@/api/programs';
import { HeroIconButton, ImmersiveHero } from '@/components/detail/ImmersiveHero';
import { StickyPriceRail } from '@/components/detail/StickyPriceRail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatPriceCents } from '@/lib/format';

// Real enroll flow — previously ProgramsList only displayed programs with
// no tap-through at all, unlike web's /programs/:id + enroll form.
export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: program } = useQuery({ queryKey: ['program', id], queryFn: () => fetchProgram(id) });

  function handleShare() {
    if (!program) return;
    router.push({
      pathname: '/(modals)/share',
      params: {
        title: 'Share this program',
        text: `${program.title} at ${program.listingName}, via HelloCircle: https://hellocircle.ie/programs/${program.id}`,
        link: `https://hellocircle.ie/programs/${program.id}`,
      },
    });
  }

  if (!program) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isFull = program.spotsLeft !== null && program.spotsLeft <= 0;

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView>
          <ImmersiveHero
            imageUrl={program.imageUrl}
            placeholderIcon="school-outline"
            onBack={() => router.back()}
            actions={<HeroIconButton onPress={handleShare} icon="share-outline" label="Share" />}
          />
          <View style={{ padding: Spacing.four, gap: Spacing.three }}>
            <View style={{ gap: 4 }}>
              <ThemedText type="eyebrow">{program.listingName}</ThemedText>
              <ThemedText type="editorial">{program.title}</ThemedText>
              <ThemedText themeColor="textSecondary">
                {program.ageRange}
                {program.skillLevel ? ` · ${program.skillLevel}` : ''}
                {program.spotsLeft !== null ? ` · ${isFull ? 'Full' : `${program.spotsLeft} spots left`}` : ''}
              </ThemedText>
            </View>

            {program.description && <ThemedText>{program.description}</ThemedText>}

            {program.instructorName && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Instructor</ThemedText>
                <ThemedText themeColor="textSecondary">{program.instructorName}</ThemedText>
              </View>
            )}

            {program.equipment.length > 0 && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">What to bring</ThemedText>
                <ThemedText themeColor="textSecondary">{program.equipment.join(' · ')}</ThemedText>
              </View>
            )}

            {program.sessions.length > 0 && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Sessions</ThemedText>
                {program.sessions.map((session) => (
                  <ThemedText key={session.id} themeColor="textSecondary">
                    {session.date} · {session.time}
                    {session.instructorName ? ` · ${session.instructorName}` : ''}
                  </ThemedText>
                ))}
              </View>
            )}

            {program.guardianRules && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Guardian rules</ThemedText>
                <ThemedText themeColor="textSecondary">{program.guardianRules}</ThemedText>
              </View>
            )}
            {program.safeguardingInfo && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Safeguarding</ThemedText>
                <ThemedText themeColor="textSecondary">{program.safeguardingInfo}</ThemedText>
              </View>
            )}
          </View>
        </ScrollView>
        <StickyPriceRail
          priceLabel={formatPriceCents(program.priceCents)}
          ctaLabel={isFull ? 'Full' : 'Enroll'}
          onPress={isFull ? undefined : () => router.push({ pathname: '/program-enrollment/[programId]/details', params: { programId: program.id } })}
        />
      </SafeAreaView>
    </ThemedView>
  );
}
