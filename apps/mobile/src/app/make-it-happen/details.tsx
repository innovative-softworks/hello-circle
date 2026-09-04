import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { confirmMakeItHappen } from '@/api/makeItHappen';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openCheckoutAndAwaitReturn } from '@/lib/checkout';

import { useMakeItHappenStore } from './_store';

export default function MakeItHappenDetailsScreen() {
  const draft = useMakeItHappenStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = draft.name.trim().length > 0 && draft.email.trim().length > 0 && draft.phone.trim().length > 0;

  async function handleConfirm() {
    if (useAuthStore.getState().status !== 'signedIn') {
      router.push('/auth/sign-in');
      return;
    }
    const chosen = draft.chosenCandidate;
    if (!chosen) return;
    setPending(true);
    setError(null);
    try {
      const res = await confirmMakeItHappen({
        activityLabel: draft.activityLabel,
        county: draft.county,
        date: draft.date,
        time: draft.time,
        duration: draft.duration,
        partySize: draft.partySize,
        centreId: chosen.centreId,
        roomId: chosen.roomId,
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        notes: draft.notes || undefined,
      });
      if (res.url) {
        const outcome = await openCheckoutAndAwaitReturn(res.url);
        if (outcome.status !== 'success') {
          setError('Checkout was not completed.');
          return;
        }
      }
      router.replace({ pathname: '/make-it-happen/confirmation', params: { ref: res.ref, totalEuro: String(res.totalEuro) } });
    } catch {
      setError("Couldn't confirm — please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <LabeledInput label="Your name" value={draft.name} onChangeText={(text) => draft.setField('name', text)} />
          <LabeledInput label="Email" value={draft.email} onChangeText={(text) => draft.setField('email', text)} keyboardType="email-address" autoCapitalize="none" />
          <LabeledInput label="Phone" value={draft.phone} onChangeText={(text) => draft.setField('phone', text)} keyboardType="phone-pad" />
          <LabeledInput label="Notes (optional)" value={draft.notes} onChangeText={(text) => draft.setField('notes', text)} />

          {error && <ThemedText themeColor="danger">{error}</ThemedText>}

          <Button label="Confirm & book" onPress={handleConfirm} loading={pending} disabled={!canConfirm} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function LabeledInput(props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences';
}) {
  const theme = useTheme();
  return (
    <View>
      <ThemedText>{props.label}</ThemedText>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize}
        style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: Spacing.two, color: theme.text }}
      />
    </View>
  );
}
