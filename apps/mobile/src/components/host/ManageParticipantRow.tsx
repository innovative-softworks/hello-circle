import type { ManageParticipant } from '@hello-circle/types';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ManageParticipantRow({ participant, onRemove }: { participant: ManageParticipant; onRemove: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderColor: theme.border }]}>
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.name}>{participant.name}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {participant.status} · {participant.paymentStatus}
          {participant.attended != null ? ` · ${participant.attended ? 'Attended' : 'No-show'}` : ''}
        </ThemedText>
      </View>
      <Pressable onPress={onRemove}>
        <ThemedText themeColor="danger">Remove</ThemedText>
      </Pressable>
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
  name: {
    fontWeight: '700',
  },
});
