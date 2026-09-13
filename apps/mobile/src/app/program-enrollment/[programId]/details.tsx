import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { enrollProgram, fetchProgram, fetchProgramEnrollmentStatus } from '@/api/programs';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openCheckoutAndAwaitReturn, pollUntilPaid } from '@/lib/checkout';
import { formatPriceCents } from '@/lib/format';

// One-step form — unlike the room-booking flow, a program enrollment is a
// single fixed-price sign-up (POST /:id/enroll covers every session), so
// there's no session/date step to wizard through, matching web's own
// single-page enroll form.
export default function ProgramEnrollmentDetailsScreen() {
  const { programId } = useLocalSearchParams<{ programId: string }>();
  const { data: program } = useQuery({ queryKey: ['program', programId], queryFn: () => fetchProgram(programId) });

  const [participantName, setParticipantName] = useState('');
  const [participantDob, setParticipantDob] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = participantName.trim().length > 0 && email.trim().length > 0;

  async function handleEnroll() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await enrollProgram(programId, {
        participantName: participantName.trim(),
        participantDob: participantDob.trim() || undefined,
        email: email.trim(),
        phone: phone.trim() || undefined,
      });
      if (res.url) {
        const outcome = await openCheckoutAndAwaitReturn(res.url);
        if (outcome.status !== 'success') {
          setError('Checkout was not completed.');
          return;
        }
        await pollUntilPaid(fetchProgramEnrollmentStatus, res.ref);
      }
      router.replace({ pathname: '/program-enrollment/[programId]/confirmation', params: { programId, ref: res.ref, totalEuro: String(res.totalEuro) } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't enroll — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="pageHeading">Enroll{program ? ` — ${program.title}` : ''}</ThemedText>

          <LabeledInput label="Participant's name" value={participantName} onChangeText={setParticipantName} />
          <LabeledInput label="Date of birth (YYYY-MM-DD, optional)" value={participantDob} onChangeText={setParticipantDob} />
          <LabeledInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <LabeledInput label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

          {program && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.two }}>
              <ThemedText type="sectionHeading">Total</ThemedText>
              <ThemedText type="sectionHeading" themeColor="primary">
                {formatPriceCents(program.priceCents)}
              </ThemedText>
            </View>
          )}

          {error && <ThemedText themeColor="danger">{error}</ThemedText>}

          <Button label="Confirm enrollment" onPress={handleEnroll} loading={submitting} disabled={!canSubmit} />
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
