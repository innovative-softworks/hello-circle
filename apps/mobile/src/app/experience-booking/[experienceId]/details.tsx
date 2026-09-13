import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { bookExperienceSession, fetchExperience, fetchExperienceBookingStatus } from '@/api/experiences';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openCheckoutAndAwaitReturn, pollUntilPaid } from '@/lib/checkout';
import { formatPriceCents } from '@/lib/format';

// One step (party size + contact details), same shape as booking/
// registration's own details step — books ONE session (a real capacity
// check happens server-side, row-locked the same way a room booking is).
export default function ExperienceBookingDetailsScreen() {
  const theme = useTheme();
  const { experienceId, sessionId } = useLocalSearchParams<{ experienceId: string; sessionId: string }>();
  const { data: experience } = useQuery({ queryKey: ['experience', experienceId], queryFn: () => fetchExperience(experienceId) });
  const session = experience?.sessions.find((s) => s.id === sessionId);

  const [partySize, setPartySize] = useState(1);
  const [participantName, setParticipantName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = participantName.trim().length > 0 && email.trim().length > 0;
  const maxParty = session ? Math.min(session.spotsLeft, 10) : 10;

  async function handleBook() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await bookExperienceSession(experienceId, sessionId, {
        participantName: participantName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        partySize,
      });
      if (res.url) {
        const outcome = await openCheckoutAndAwaitReturn(res.url);
        if (outcome.status !== 'success') {
          setError('Checkout was not completed.');
          return;
        }
        await pollUntilPaid(fetchExperienceBookingStatus, res.ref);
      }
      router.replace({ pathname: '/experience-booking/[experienceId]/confirmation', params: { experienceId, ref: res.ref, totalEuro: String(res.totalEuro) } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't complete this booking — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="pageHeading">{experience?.title ?? 'Book'}</ThemedText>
          {session && (
            <ThemedText themeColor="textSecondary">
              {session.date} · {session.time}
            </ThemedText>
          )}

          <View style={{ gap: Spacing.one }}>
            <ThemedText>Party size</ThemedText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
              <Pressable
                onPress={() => setPartySize(Math.max(1, partySize - 1))}
                style={{ width: 40, height: 40, borderRadius: Radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="remove" size={20} color={theme.text} />
              </Pressable>
              <ThemedText type="cardHeading" style={{ minWidth: 24, textAlign: 'center' }}>
                {partySize}
              </ThemedText>
              <Pressable
                onPress={() => setPartySize(Math.min(maxParty, partySize + 1))}
                style={{ width: 40, height: 40, borderRadius: Radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="add" size={20} color={theme.text} />
              </Pressable>
            </View>
          </View>

          <LabeledInput label="Your name" value={participantName} onChangeText={setParticipantName} />
          <LabeledInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <LabeledInput label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

          {experience && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.two }}>
              <ThemedText type="sectionHeading">Total</ThemedText>
              <ThemedText type="sectionHeading" themeColor="primary">
                {formatPriceCents(experience.priceCents * partySize)}
              </ThemedText>
            </View>
          )}

          {error && <ThemedText themeColor="danger">{error}</ThemedText>}

          <Button label="Confirm booking" onPress={handleBook} loading={submitting} disabled={!canSubmit} />
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
        placeholderTextColor={theme.textSecondary}
        style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, padding: Spacing.two, color: theme.text }}
      />
    </View>
  );
}
