import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { fetchClub } from '@/api/clubs';
import { createRegistrationCheckout, fetchRegistrationStatus, joinClubWaitlist } from '@/api/registrations';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StickyPriceRail } from '@/components/detail/StickyPriceRail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { openCheckoutAndAwaitReturn, pollUntilPaid } from '@/lib/checkout';
import { formatPrice } from '@/lib/format';

import { useRegistrationDraftStore } from '@/registration/store';

export default function RegistrationReviewStep() {
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const draft = useRegistrationDraftStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFull, setIsFull] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);

  const { data: club } = useQuery({ queryKey: ['club', clubId], queryFn: () => fetchClub(clubId) });
  const isAdult = draft.registrantType === 'adult';

  async function handleConfirm() {
    setPending(true);
    setError(null);
    setIsFull(false);
    try {
      const res = await createRegistrationCheckout({
        clubId,
        registrantType: draft.registrantType,
        team: isAdult ? undefined : draft.team,
        childFirst: draft.childFirst,
        childLast: draft.childLast,
        dob: isAdult ? undefined : draft.dob,
        gFirst: isAdult ? draft.childFirst : draft.gFirst,
        gLast: isAdult ? draft.childLast : draft.gLast,
        email: draft.email,
        phone: draft.phone,
        address: draft.address,
        ecName: draft.ecName || undefined,
        ecPhone: draft.ecPhone || undefined,
        ecRel: draft.ecRel || undefined,
        consent: draft.consent,
        trial: draft.trial,
      });
      if (res.url) {
        const outcome = await openCheckoutAndAwaitReturn(res.url);
        if (outcome.status !== 'success') {
          setError('Checkout was not completed.');
          return;
        }
        await pollUntilPaid(fetchRegistrationStatus, res.ref);
      }
      router.replace({ pathname: '/registration/[clubId]/confirmation', params: { clubId, ref: res.ref, trial: String(res.trial) } });
    } catch (e) {
      if (e instanceof ApiError && e.body.full) {
        setIsFull(true);
      } else {
        setError("Couldn't complete registration — please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleJoinWaitlist() {
    setPending(true);
    try {
      await joinClubWaitlist(clubId, { name: `${draft.childFirst} ${draft.childLast}`.trim(), email: draft.email });
      setWaitlisted(true);
    } finally {
      setPending(false);
    }
  }

  if (isFull) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText type="sectionHeading">This club is full</ThemedText>
          {waitlisted ? (
            <ThemedText themeColor="primary">You&apos;re on the waitlist — we&apos;ll email you if a spot opens up.</ThemedText>
          ) : (
            <Button label="Join waitlist" onPress={handleJoinWaitlist} loading={pending} />
          )}
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isCash = club?.paymentMethod === 'cash' || draft.trial;
  const priceLabel = draft.trial ? 'Free trial' : club ? `${formatPrice(club.price)}/${club.unit}` : '';

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="pageHeading">Review</ThemedText>

          <Card imageUrl={club?.image} placeholderIcon="people-outline">
            <ThemedText type="cardHeading">{club?.name}</ThemedText>
            <ThemedText themeColor="textSecondary">
              {draft.childFirst} {draft.childLast} · {draft.email}
            </ThemedText>
            {!isAdult && draft.team && <ThemedText themeColor="textSecondary">{draft.team}</ThemedText>}
            {isCash ? (
              <ThemedText themeColor="primary">{priceLabel}</ThemedText>
            ) : (
              <ThemedText themeColor="primary">Estimated {priceLabel} + VAT and platform fee, calculated at checkout</ThemedText>
            )}
          </Card>

          {error && <ThemedText themeColor="danger">{error}</ThemedText>}
        </ScrollView>
        <StickyPriceRail priceLabel={priceLabel} ctaLabel="Register" onPress={handleConfirm} loading={pending} />
      </SafeAreaView>
    </ThemedView>
  );
}
