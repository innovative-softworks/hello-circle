import type { Review } from '@hello-circle/types';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ReviewCard({ review }: { review: Review }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <View style={styles.header}>
        <ThemedText style={styles.name}>{review.name}</ThemedText>
        <ThemedText themeColor="primary">{'★'.repeat(review.rating)}</ThemedText>
      </View>
      {review.comment.length > 0 && <ThemedText themeColor="textSecondary">{review.comment}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopWidth: 1,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  name: {
    fontWeight: '700',
  },
});
