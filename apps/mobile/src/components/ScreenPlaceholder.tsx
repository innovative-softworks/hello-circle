import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export function ScreenPlaceholder({ title, phase = 2 }: { title: string; phase?: number }) {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four }}>
        <ThemedText type="subtitle">{title}</ThemedText>
        <ThemedText themeColor="textSecondary">Coming in Phase {phase}</ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}
