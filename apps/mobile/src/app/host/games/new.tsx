import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createGame } from '@/api/games';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { EMPTY_GAME_FORM, GameForm, gameFormValuesToInput, type GameFormValues } from '@/components/host/GameForm';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function NewGameScreen() {
  const queryClient = useQueryClient();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: GameFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const game = await createGame(gameFormValuesToInput(values));
      queryClient.invalidateQueries({ queryKey: ['my-games-hosted'] });
      router.replace({ pathname: '/host/games/[id]/manage', params: { id: game.id } });
    } catch {
      setError("Couldn't create this game — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!signedIn) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText type="pageHeading">Organize a Game</ThemedText>
          <ThemedText themeColor="textSecondary">Sign in to organize a game.</ThemedText>
          <Button label="Sign in" onPress={() => router.push('/auth/sign-in')} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <GameForm initial={EMPTY_GAME_FORM} submitLabel="Create game" onSubmit={handleSubmit} submitting={submitting} error={error} />
      </SafeAreaView>
    </ThemedView>
  );
}
