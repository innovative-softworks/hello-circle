import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cancelBooking } from '@/api/bookings';
import { fetchCentre } from '@/api/centres';
import { ApiError } from '@/api/client';
import { fetchReceipts } from '@/api/participation';
import { Button } from '@/components/Button';
import { ReceiptQr } from '@/components/my-life/ReceiptQr';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addToCalendar } from '@/lib/calendar';
import { formatPriceCents } from '@/lib/format';

// A dedicated, richer detail screen for booking-kind receipts specifically
// (Places & Spaces module reference) — real directions/cancel actions, not
// just the generic QR-only receipt view every other participation kind
// still uses (those have their own live detail screens already, see
// ParticipationRow's comment).
export default function BookingDetailScreen() {
  const theme = useTheme();
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const queryClient = useQueryClient();
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const { data: receipts } = useQuery({ queryKey: ['receipts'], queryFn: fetchReceipts });
  const receipt = receipts?.find((r) => r.ref === ref);
  const { data: centre } = useQuery({ queryKey: ['centre', receipt?.centreId], queryFn: () => fetchCentre(receipt!.centreId!), enabled: !!receipt?.centreId });

  async function handleAddToCalendar() {
    if (!receipt) return;
    setCalendarStatus(null);
    try {
      await addToCalendar({
        title: receipt.label,
        date: receipt.date ?? receipt.createdAt.slice(0, 10),
        time: receipt.time ?? undefined,
        allDay: !receipt.time,
        notes: `Ref: ${receipt.ref}`,
      });
      setCalendarStatus('Added to your calendar.');
    } catch {
      setCalendarStatus("Couldn't add to calendar — check calendar permission in Settings.");
    }
  }

  function handleDirections() {
    if (!centre) return;
    const query = encodeURIComponent([centre.name, centre.area, centre.county].filter(Boolean).join(', '));
    Linking.openURL(`https://maps.google.com/?q=${query}`);
  }

  function handleShare() {
    if (!receipt) return;
    router.push({
      pathname: '/(modals)/share',
      params: {
        title: 'Share this booking',
        text: `${receipt.label}${receipt.date ? ` on ${receipt.date}` : ''}${receipt.time ? ` at ${receipt.time}` : ''}, via HelloCircle.`,
        link: `https://hellocircle.ie/bookings/${receipt.ref}`,
      },
    });
  }

  function confirmCancel() {
    Alert.alert('Cancel this booking?', 'Free cancellation up to 48h before the booking — this can’t be undone.', [
      { text: 'Keep booking', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: doCancel },
    ]);
  }

  async function doCancel() {
    if (!receipt) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelBooking(receipt.ref);
      await queryClient.invalidateQueries({ queryKey: ['receipts'] });
      await queryClient.invalidateQueries({ queryKey: ['my-participation'] });
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : "Couldn't cancel this booking — please try again.");
    } finally {
      setCancelling(false);
    }
  }

  if (!receipt) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const cancelled = receipt.paymentStatus === 'cancelled';

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: receipt.label }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three, alignItems: 'center' }}>
          <ThemedText type="pageHeading" style={{ textAlign: 'center' }}>
            {receipt.label}
          </ThemedText>
          {receipt.date && (
            <ThemedText themeColor="textSecondary">
              {receipt.date}
              {receipt.time ? ` at ${receipt.time}` : ''}
            </ThemedText>
          )}
          {centre && (
            <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
              {centre.name} · {centre.area}, {centre.county}
            </ThemedText>
          )}
          <ThemedText themeColor={cancelled ? 'danger' : 'primary'} style={{ textTransform: 'capitalize' }}>
            {receipt.paymentStatus}
          </ThemedText>
          <ThemedText>{formatPriceCents(receipt.totalCents)}</ThemedText>
          <ThemedText themeColor="textSecondary">Ref: {receipt.ref}</ThemedText>

          <ReceiptQr reference={receipt.ref} />

          <View style={{ width: '100%', gap: Spacing.two }}>
            <Button label="Add to calendar" variant="secondary" onPress={handleAddToCalendar} />
            {centre && (
              <Pressable onPress={handleDirections} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.three }}>
                <Ionicons name="navigate-outline" size={18} color={theme.primary} />
                <ThemedText type="smallBold" themeColor="primary">
                  Get directions
                </ThemedText>
              </Pressable>
            )}
            <Pressable onPress={handleShare} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.three }}>
              <Ionicons name="share-outline" size={18} color={theme.primary} />
              <ThemedText type="smallBold" themeColor="primary">
                Share
              </ThemedText>
            </Pressable>
            {!cancelled && receipt.paymentStatus === 'paid' && (
              <Button
                label="Change date & time"
                variant="secondary"
                onPress={() => router.push({ pathname: '/(details)/booking/[ref]/reschedule', params: { ref: receipt.ref } })}
              />
            )}
            {!cancelled && receipt.paymentStatus === 'paid' && (
              <Button label="Cancel booking" variant="secondary" onPress={confirmCancel} loading={cancelling} />
            )}
          </View>
          {calendarStatus && <ThemedText themeColor="textSecondary">{calendarStatus}</ThemedText>}
          {cancelError && <ThemedText themeColor="danger">{cancelError}</ThemedText>}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
