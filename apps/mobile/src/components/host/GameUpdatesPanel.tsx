import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { fetchGameUpdates, postGameUpdate } from '@/api/games';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// A host broadcast tool, not a chat (compare components/chat/ChatPanel.tsx)
// — single refetch after posting, no polling, since only the host ever writes.
export function GameUpdatesPanel({ gameId }: { gameId: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const updatesQuery = useQuery({ queryKey: ['game-updates', gameId], queryFn: () => fetchGameUpdates(gameId) });
  const updates = updatesQuery.data ?? [];

  async function handlePost() {
    const message = draft.trim();
    if (!message) return;
    setPosting(true);
    try {
      await postGameUpdate(gameId, message);
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['game-updates', gameId] });
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="sectionHeading">Updates</ThemedText>
      {updates.map((update) => (
        <View key={update.id}>
          <ThemedText>{update.message}</ThemedText>
          <ThemedText themeColor="textSecondary" style={{ fontSize: 12 }}>
            {update.createdAt}
          </ThemedText>
        </View>
      ))}
      {!updates.length && <ThemedText themeColor="textSecondary">No updates posted yet.</ThemedText>}
      <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center' }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Post an update…"
          placeholderTextColor={theme.textSecondary}
          style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: Spacing.two, color: theme.text }}
        />
        <Button label="Post" onPress={handlePost} loading={posting} disabled={!draft.trim()} />
      </View>
    </View>
  );
}
