import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useRegistrationDraftStore } from '@/registration/store';

export default function RegistrationMedicalStep() {
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const theme = useTheme();
  const { medical, consent, setField } = useRegistrationDraftStore();

  function handleNext() {
    router.push({ pathname: '/registration/[clubId]/review', params: { clubId } });
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="pageHeading">Medical &amp; consent</ThemedText>

          <View>
            <ThemedText>Medical notes (optional)</ThemedText>
            <TextInput
              value={medical}
              onChangeText={(text) => setField('medical', text)}
              multiline
              placeholder="Allergies, conditions we should know about…"
              placeholderTextColor={theme.textSecondary}
              style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, padding: Spacing.two, color: theme.text, minHeight: 80, textAlignVertical: 'top' }}
            />
          </View>

          <Pressable onPress={() => setField('consent', !consent)} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: Radius.subtle,
                borderWidth: 1.5,
                borderColor: consent ? theme.primary : theme.border,
                backgroundColor: consent ? theme.primary : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {consent && <ThemedText style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>✓</ThemedText>}
            </View>
            <ThemedText style={{ flex: 1 }}>I confirm the information provided is accurate and consent to this registration.</ThemedText>
          </Pressable>

          <Button label="Continue" onPress={handleNext} disabled={!consent} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
