import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// Honest empty states per master-prompt §26 — never seed fake results.
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={{ textAlign: 'center' }}>
        {title}
      </ThemedText>
      {description && (
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {description}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
});
