import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchGame, fetchGameJoinStatus, joinGame, joinGameWaitlist, leaveGame, leaveGameWaitlist } from '@/api/games';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { openCheckoutAndAwaitReturn, pollUntilPaid } from '@/lib/checkout';
import { formatPriceCents } from '@/lib/format';

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const gameQuery = useQuery({ queryKey: ['game', id], queryFn: () => fetchGame(id) });
  const game = gameQuery.data;

  async function refetch() {
    await queryClient.invalidateQueries({ queryKey: ['game', id] });
  }

  async function handleJoin() {
    setPending(true);
    setMessage(null);
    try {
      const res = await joinGame(id);
      if (res.url) {
        const outcome = await openCheckoutAndAwaitReturn(res.url);
        if (outcome.status !== 'success') {
          setMessage('Checkout was not completed.');
          return;
        }
        const statusRow = await pollUntilPaid(fetchGameJoinStatus, res.ref!);
        if (statusRow.paymentStatus !== 'paid') {
          setMessage("Still confirming your payment — check My Life shortly if this doesn't update.");
        }
      }
      await refetch();
    } finally {
      setPending(false);
    }
  }

  async function handleLeave() {
    setPending(true);
    try {
      await leaveGame(id);
      await refetch();
    } finally {
      setPending(false);
    }
  }

  async function handleJoinWaitlist() {
    setPending(true);
    try {
      await joinGameWaitlist(id);
      await refetch();
    } finally {
      setPending(false);
    }
  }

  async function handleLeaveWaitlist() {
    setPending(true);
    try {
      await leaveGameWaitlist(id);
      await refetch();
    } finally {
      setPending(false);
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

  const isFull = game.spotsLeft <= 0;

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: game.activityLabel }} />
      <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText type="title">{game.activityLabel}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {game.date} at {game.time} · {game.centreName ?? game.locationText} · {game.area}
        </ThemedText>
        <ThemedText themeColor="textSecondary">Skill level: {game.skillLevel}</ThemedText>
        <ThemedText themeColor="primary">{formatPriceCents(game.priceCents)}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {game.joined}/{game.capacity} joined{game.spotsLeft > 0 ? ` · ${game.spotsLeft} spots left` : ''}
        </ThemedText>

        {game.status === 'pending_participants' && game.minParticipants !== null && (
          <ThemedText themeColor="primary">Needs {game.minParticipants} players to confirm — still joinable.</ThemedText>
        )}

        <View>
          <ThemedText type="subtitle">Host</ThemedText>
          <ThemedText themeColor="textSecondary">
            {game.hostName}
            {game.hostVerified ? ' · Verified' : ''}
          </ThemedText>
        </View>

        {message && <ThemedText themeColor="textSecondary">{message}</ThemedText>}

        {game.joinedByMe ? (
          <Button label="Leave" onPress={handleLeave} loading={pending} />
        ) : game.waitlistedByMe ? (
          <Button label="Leave waitlist" onPress={handleLeaveWaitlist} loading={pending} />
        ) : isFull ? (
          <Button label="Join waitlist" onPress={handleJoinWaitlist} loading={pending} />
        ) : (
          <Button label="Join" onPress={handleJoin} loading={pending} />
        )}
      </ScrollView>
    </ThemedView>
  );
}
