import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cancelGame, fetchGame, fetchGameParticipantsForManage, removeGameParticipant } from '@/api/games';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { GameUpdatesPanel } from '@/components/host/GameUpdatesPanel';
import { ManageParticipantRow } from '@/components/host/ManageParticipantRow';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function ManageGameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const residentId = useAuthStore((state) => state.residentId);
  const [cancelling, setCancelling] = useState(false);

  const gameQuery = useQuery({ queryKey: ['game', id], queryFn: () => fetchGame(id) });
  const participantsQuery = useQuery({ queryKey: ['game-manage-participants', id], queryFn: () => fetchGameParticipantsForManage(id) });
  const game = gameQuery.data;

  if (!game) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  // Defense in depth — the server already 403s every host-only call below;
  // this just avoids a flash of host-only controls for anyone who lands
  // here without being the host (e.g. a stale/shared link).
  if (residentId !== game.hostResidentId) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four }}>
          <ThemedText themeColor="textSecondary">You don&apos;t have access to manage this game.</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  function handleCancel() {
    Alert.alert('Cancel this game?', 'Everyone who joined will be notified.', [
      { text: 'Keep game', style: 'cancel' },
      {
        text: 'Cancel game',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true);
          try {
            await cancelGame(id);
            queryClient.invalidateQueries({ queryKey: ['game', id] });
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  }

  function handleRemove(participantResidentId: string, name: string) {
    Alert.alert(`Remove ${name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeGameParticipant(id, participantResidentId);
          queryClient.invalidateQueries({ queryKey: ['game-manage-participants', id] });
          queryClient.invalidateQueries({ queryKey: ['game', id] });
        },
      },
    ]);
  }

  const participants = participantsQuery.data ?? [];

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: game.activityLabel }} />
      <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText type="pageHeading">{game.activityLabel}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {game.date} at {game.time} · {game.joined}/{game.capacity} joined
        </ThemedText>
        {game.status === 'cancelled' && <ThemedText themeColor="danger">This game is cancelled.</ThemedText>}

        {game.status !== 'cancelled' && (
          <View style={styles.actionsRow}>
            <Button label="Edit" onPress={() => router.push({ pathname: '/host/games/[id]/edit', params: { id } })} />
            <Button label="Cancel game" onPress={handleCancel} loading={cancelling} />
          </View>
        )}

        <View style={{ gap: Spacing.two }}>
          <ThemedText type="sectionHeading">Participants</ThemedText>
          {participants.map((participant) => (
            <ManageParticipantRow key={participant.residentId} participant={participant} onRemove={() => handleRemove(participant.residentId, participant.name)} />
          ))}
          {!participants.length && <ThemedText themeColor="textSecondary">No one has joined yet.</ThemedText>}
        </View>

        <GameUpdatesPanel gameId={id} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
