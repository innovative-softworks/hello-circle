import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchGameParticipants } from '@/api/games';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Full participant list (spec's "People Going" screen) — real names only,
// same public preview endpoint the game detail screen's AvatarGroup already
// uses (server/src/routes/games.ts's GET /:id/participants, mutual-block
// filtered, name-only per its own privacy convention). No join-date field
// exists on this data, so unlike the mockup's "joined X days ago" caption,
// each row shows only the real name — never a fabricated timestamp.
export default function GameGoingScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useQuery({ queryKey: ['game-participants', id], queryFn: () => fetchGameParticipants(id) });

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="pageHeading">People Going{data ? ` (${data.total})` : ''}</ThemedText>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.four }}>
          {(data?.participants ?? []).map((person) => (
            <View key={person.residentId} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
              <Avatar name={person.name} size={44} />
              <ThemedText type="cardHeading">{person.name}</ThemedText>
            </View>
          ))}
        </ScrollView>

        <View style={{ padding: Spacing.four }}>
          <Button label="Message Group" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}
