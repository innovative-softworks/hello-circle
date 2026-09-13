import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { confirmMakeItHappen } from '@/api/makeItHappen';
import { useAuthStore } from '@/auth/store';
import { setPendingAction } from '@/auth/pendingAction';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openCheckoutAndAwaitReturn } from '@/lib/checkout';
import { formatPriceCents } from '@/lib/format';

import { useMakeItHappenStore } from '@/makeItHappen/store';

export default function MakeItHappenDetailsScreen() {
  const theme = useTheme();
  const draft = useMakeItHappenStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = draft.name.trim().length > 0 && draft.email.trim().length > 0 && draft.phone.trim().length > 0;

  async function handleConfirm() {
    if (useAuthStore.getState().status !== 'signedIn') {
      // The draft (activity/date/county/chosen space/contact details) lives
      // in an in-memory store only, so this can't survive the app being
      // killed during the magic-link round trip — but it does survive the
      // common case (backgrounded, not killed), so it's still worth
      // returning here rather than dropping the user on My Life instead.
      await setPendingAction({ kind: 'returnTo', screenPath: '/make-it-happen/details' });
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
          <ThemedText type="pageHeading">Your details</ThemedText>

          {draft.chosenCandidate && (
            <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card, padding: Spacing.three, gap: 2 }}>
              <ThemedText type="cardHeading">{draft.chosenCandidate.centreName}</ThemedText>
              <ThemedText themeColor="textSecondary">
                {draft.chosenCandidate.roomName} · {draft.chosenCandidate.area}, {draft.chosenCandidate.county}
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                {draft.date} at {draft.time} · {draft.duration}h · {draft.partySize} people
              </ThemedText>
              <ThemedText themeColor="primary">
                {formatPriceCents(draft.chosenCandidate.totalCents)}
                {draft.chosenCandidate.paymentMethod === 'cash' ? ' · cash on arrival' : ''}
              </ThemedText>
            </View>
          )}

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
        style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, padding: Spacing.two, color: theme.text }}
      />
    </View>
  );
}
