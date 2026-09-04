import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchGame, updateGame } from '@/api/games';
import { GameForm, gameFormValuesToInput, type GameFormValues } from '@/components/host/GameForm';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function EditGameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gameQuery = useQuery({ queryKey: ['game', id], queryFn: () => fetchGame(id) });
  const game = gameQuery.data;

  async function handleSubmit(values: GameFormValues) {
    if (!game) return;
    setSubmitting(true);
    setError(null);
    try {
      // Preserve every field this MVP form doesn't expose — PUT /:id
      // overwrites the full row, so omitting these would silently wipe them.
      const input = gameFormValuesToInput(values, {
        centreId: game.centreId ?? undefined,
        confirmationDeadline: game.confirmationDeadline ?? undefined,
        equipmentNeeded: game.equipmentNeeded ?? undefined,
        minAge: game.minAge ?? undefined,
        surfaceType: game.surfaceType ?? undefined,
        indoorOutdoor: game.indoorOutdoor ?? undefined,
        meetingInstructions: game.meetingInstructions ?? undefined,
        cancellationPolicy: game.cancellationPolicy ?? undefined,
        circleId: game.circleId ?? undefined,
      });
      await updateGame(id, input);
      queryClient.invalidateQueries({ queryKey: ['game', id] });
      router.back();
    } catch {
      setError("Couldn't save changes — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!game) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const initial: GameFormValues = {
    activityLabel: game.activityLabel,
    locationText: game.locationText,
    date: game.date,
    time: game.time,
    capacity: String(game.capacity),
    skillLevel: game.skillLevel,
    priceCents: game.priceCents != null ? String(game.priceCents / 100) : '',
    visibility: game.visibility === 'invite' ? 'invite' : 'public',
    soloFriendly: game.soloFriendly,
    minParticipants: game.minParticipants != null ? String(game.minParticipants) : '',
    description: game.description ?? '',
    durationMinutes: game.durationMinutes != null ? String(game.durationMinutes) : '',
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: `Edit ${game.activityLabel}` }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <GameForm initial={initial} submitLabel="Save changes" onSubmit={handleSubmit} submitting={submitting} error={error} />
      </SafeAreaView>
    </ThemedView>
  );
}
