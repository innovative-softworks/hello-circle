import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function CheckEmailScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
        <ThemedText type="subtitle">Check your inbox</ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          Tap the link we just emailed you to finish signing in. It expires in 15 minutes.
        </ThemedText>
        <Button label="Done" onPress={() => router.dismissAll()} />
      </SafeAreaView>
    </ThemedView>
  );
}
