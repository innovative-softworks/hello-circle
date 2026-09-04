import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, View } from 'react-native';

import { fetchCircleJoinRequests, respondToCircleJoinRequest } from '@/api/circles';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function JoinRequestsList({ circleId }: { circleId: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const requestsQuery = useQuery({ queryKey: ['circle-join-requests', circleId], queryFn: () => fetchCircleJoinRequests(circleId) });
  const requests = requestsQuery.data ?? [];

  if (!requests.length) return null;

  async function respond(requestId: string, accept: boolean) {
    await respondToCircleJoinRequest(circleId, requestId, accept);
    queryClient.invalidateQueries({ queryKey: ['circle-join-requests', circleId] });
    queryClient.invalidateQueries({ queryKey: ['circle-members-manage', circleId] });
    queryClient.invalidateQueries({ queryKey: ['circle', circleId] });
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="subtitle">Join requests</ThemedText>
      {requests.map((req) => (
        <View key={req.id} style={[styles.row, { borderColor: theme.border }]}>
          <ThemedText style={{ flex: 1 }}>{req.name}</ThemedText>
          <View style={styles.actions}>
            <Pressable onPress={() => respond(req.id, true)}>
              <ThemedText themeColor="primary">Accept</ThemedText>
            </Pressable>
            <Pressable onPress={() => respond(req.id, false)}>
              <ThemedText themeColor="textSecondary">Decline</ThemedText>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
});
