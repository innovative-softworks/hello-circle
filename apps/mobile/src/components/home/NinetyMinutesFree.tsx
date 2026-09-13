import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { fetchFreeTimeOptions } from '@/api/discovery';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const MOODS = ['Yoga', 'Tennis', 'Coffee', 'Swimming'];

// The signature free-time mechanic (redesign spec §07/§14) — wires up
// fetchFreeTimeOptions(), which existed in the API client but had no caller
// anywhere in the app until now. Only renders when the county genuinely has
// something available in the window — no fabricated "there's always
// something" copy over an empty result.
export function NinetyMinutesFree({ county }: { county: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['free-time', county, 90],
    queryFn: () => fetchFreeTimeOptions({ county: county ?? undefined, maxMinutes: 90 }),
  });

  if (isLoading || !data?.length) return null;

  return (
    <View style={{ paddingHorizontal: Spacing.four, gap: Spacing.three }}>
      <ThemedText type="editorial">90 minutes free?</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
        {MOODS.map((mood) => (
          <Chip
            key={mood}
            label={mood}
            selected={false}
            onPress={() => router.push({ pathname: '/explore', params: { mood: mood.toLowerCase(), maxMinutes: '90' } })}
          />
        ))}
      </ScrollView>
      <ThemedText
        type="smallBold"
        themeColor="primary"
        onPress={() => router.push({ pathname: '/explore', params: { maxMinutes: '90' } })}>
        Show me something →
      </ThemedText>
    </View>
  );
}
