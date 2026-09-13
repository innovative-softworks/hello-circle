import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchGame } from '@/api/games';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addToCalendar } from '@/lib/calendar';
import { hapticSuccess } from '@/lib/haptics';

// Mirrors booking/registration/make-it-happen's emotional-confirmation
// pattern — a free join used to only flash "Joined ✓" on the button, no
// standalone celebratory moment. This gives it the same real recap the
// paid flows already get.
export default function GameJoinConfirmationScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: game } = useQuery({ queryKey: ['game', id], queryFn: () => fetchGame(id) });
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);

  useEffect(() => {
    hapticSuccess();
  }, []);

  async function handleAddToCalendar() {
    if (!game) return;
    try {
      await addToCalendar({
        title: game.activityLabel,
        date: game.date,
        time: game.time,
        durationMinutes: game.durationMinutes ?? 60,
        notes: game.centreName ?? game.locationText,
      });
      setCalendarStatus('Added to your calendar.');
    } catch {
      setCalendarStatus("Couldn't add to calendar — check calendar permission in Settings.");
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, padding: Spacing.four }}>
        <View style={{ width: 88, height: 88, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary }}>
          <Ionicons name="checkmark" size={48} color="#fff" />
        </View>

        <View style={{ gap: 4 }}>
          <ThemedText type="hero" style={{ textAlign: 'center' }}>
            You&apos;re in!
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            See you there!
          </ThemedText>
        </View>

        {game && (
          <View style={{ width: '100%', borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card, padding: Spacing.four, gap: 4 }}>
            <ThemedText type="cardHeading">{game.activityLabel}</ThemedText>
            <ThemedText themeColor="textSecondary">
              {game.date} · {game.time}
            </ThemedText>
            <ThemedText themeColor="textSecondary">{game.centreName ?? game.locationText}</ThemedText>
          </View>
        )}

        <View style={{ width: '100%', gap: Spacing.two }}>
          <Button label="Add to calendar" variant="secondary" onPress={handleAddToCalendar} />
          <Button
            label="Share with friends"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/(modals)/share',
                params: {
                  title: 'Share with friends',
                  text: game ? `${game.activityLabel} on ${game.date} at ${game.time} · ${game.centreName ?? game.locationText}. Join me: https://hellocircle.ie/games/${id}` : `https://hellocircle.ie/games/${id}`,
                  link: `https://hellocircle.ie/games/${id}`,
                },
              })
            }
          />
          <Button label="View in My Life" onPress={() => router.replace('/(tabs)/my-life')} />
        </View>
        {calendarStatus && <ThemedText themeColor="textSecondary">{calendarStatus}</ThemedText>}
      </SafeAreaView>
    </ThemedView>
  );
}
