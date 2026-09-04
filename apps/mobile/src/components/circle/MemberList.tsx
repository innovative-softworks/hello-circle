import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { fetchCircleMembers, removeCircleMember } from '@/api/circles';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function MemberList({ circleId }: { circleId: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const membersQuery = useQuery({ queryKey: ['circle-members-manage', circleId], queryFn: () => fetchCircleMembers(circleId, true) });
  const members = membersQuery.data?.members ?? [];

  function handleRemove(residentId: string, name: string) {
    Alert.alert(`Remove ${name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeCircleMember(circleId, residentId);
          queryClient.invalidateQueries({ queryKey: ['circle-members-manage', circleId] });
          queryClient.invalidateQueries({ queryKey: ['circle', circleId] });
        },
      },
    ]);
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="subtitle">Members</ThemedText>
      {members.map((member) => (
        <View key={member.residentId} style={[styles.row, { borderColor: theme.border }]}>
          <ThemedText style={{ flex: 1 }}>
            {member.name}
            {member.role === 'organiser' ? ' · Organiser' : ''}
          </ThemedText>
          {member.role !== 'organiser' && (
            <Pressable onPress={() => handleRemove(member.residentId, member.name)}>
              <ThemedText themeColor="danger">Remove</ThemedText>
            </Pressable>
          )}
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
});
