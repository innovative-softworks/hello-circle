import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="sectionHeading">{title}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
});
