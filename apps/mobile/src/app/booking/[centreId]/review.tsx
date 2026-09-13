import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createBookingCheckout, fetchBookingStatus } from '@/api/bookings';
import { fetchCentre } from '@/api/centres';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { openCheckoutAndAwaitReturn, pollUntilPaid } from '@/lib/checkout';
import { formatPrice } from '@/lib/format';

import { useBookingDraftStore } from '@/booking/store';

export default function ReviewStep() {
  const { centreId } = useLocalSearchParams<{ centreId: string }>();
  const draft = useBookingDraftStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: centre } = useQuery({ queryKey: ['centre', centreId], queryFn: () => fetchCentre(centreId) });
  const room = centre?.rooms.find((r) => r.id === draft.roomId);
  const isCash = room?.paymentMethod === 'cash';
  const estimate = room ? room.rate * draft.duration : null;

  async function handleConfirm() {
    if (!room || !draft.date || !draft.time) return;
    setPending(true);
    setError(null);
    try {
      const res = await createBookingCheckout({
        centreId,
        roomId: room.id,
        date: draft.date,
        time: draft.time,
        duration: draft.duration,
        eventType: draft.eventType,
        guests: draft.guests,
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
        await pollUntilPaid(fetchBookingStatus, res.ref);
      }
      router.replace({ pathname: '/booking/[centreId]/confirmation', params: { centreId, ref: res.ref, totalEuro: String(res.totalEuro) } });
    } catch {
      setError("Couldn't start checkout — please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.two }}>
          <ThemedText type="sectionHeading">Review</ThemedText>
          <ThemedText>{centre?.name}{room ? ` — ${room.name}` : ''}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {draft.date} at {draft.time} · {draft.duration}h · {draft.guests} guests
          </ThemedText>
          <ThemedText themeColor="textSecondary">{draft.eventType}</ThemedText>

          {estimate !== null && (
            <ThemedText themeColor="primary">
              {isCash ? `${formatPrice(estimate)} due in cash on arrival` : `Estimated ${formatPrice(estimate)} + VAT and platform fee, calculated at checkout`}
            </ThemedText>
          )}

          {error && <ThemedText themeColor="danger">{error}</ThemedText>}

          <Button label={isCash ? 'Confirm booking' : 'Confirm & pay'} onPress={handleConfirm} loading={pending} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
