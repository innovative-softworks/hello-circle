import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchClub } from '@/api/clubs';
import { Button } from '@/components/Button';
import { ConfirmationBadge } from '@/components/detail/ConfirmationBadge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addToCalendar } from '@/lib/calendar';
import { hapticSuccess } from '@/lib/haptics';

// Mirrors booking/[centreId]/confirmation.tsx's emotional-confirmation
// pattern (spec §16/§26) — checkmark badge, trusted `hero` type, a summary
// card, and a light action-row list, instead of two stacked full-width
// buttons with no summary at all.
export default function RegistrationConfirmationStep() {
  const theme = useTheme();
  const { clubId, ref, trial } = useLocalSearchParams<{ clubId: string; ref: string; trial: string }>();
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);

  const { data: club } = useQuery({ queryKey: ['club', clubId], queryFn: () => fetchClub(clubId) });

  useEffect(() => {
    hapticSuccess();
  }, []);

  async function handleAddToCalendar() {
    try {
      // No fixed session time is known without the deferred club-sessions
      // picker — an all-day event on today's date, an honest limitation.
      await addToCalendar({ title: club?.name ? `Registration: ${club.name}` : 'Club registration', date: new Date().toISOString().slice(0, 10), allDay: true, notes: `Ref: ${ref}` });
      setCalendarStatus('Added to your calendar.');
    } catch {
      setCalendarStatus("Couldn't add to calendar — check calendar permission in Settings.");
    }
  }

  const isTrial = trial === 'true';

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.four, alignItems: 'center' }}>
          <ConfirmationBadge />
          <ThemedText type="hero" style={{ textAlign: 'center' }}>
            {isTrial ? "You're in for a trial." : "You're registered."}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {isTrial ? 'See you at your first session.' : "You'll hear from the club soon."}
          </ThemedText>

          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            {club && <ThemedText type="cardHeading">{club.name}</ThemedText>}
            <ThemedText themeColor="textSecondary" style={{ marginTop: 4 }}>
              Ref: {ref}
            </ThemedText>
          </View>

          <View style={{ width: '100%', gap: Spacing.two }}>
            <Button label="View in My Life" onPress={() => router.replace('/(tabs)/my-life')} />
            <ActionRow label="Add to calendar" onPress={handleAddToCalendar} />
          </View>
          {calendarStatus && <ThemedText themeColor="textSecondary">{calendarStatus}</ThemedText>}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.actionRow, { borderColor: theme.border }]}>
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.four,
    gap: 4,
  },
  actionRow: {
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
