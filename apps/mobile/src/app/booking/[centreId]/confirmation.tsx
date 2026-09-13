import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchCentre } from '@/api/centres';
import { Button } from '@/components/Button';
import { ConfirmationBadge } from '@/components/detail/ConfirmationBadge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addToCalendar } from '@/lib/calendar';
import { formatPrice } from '@/lib/format';
import { hapticSuccess } from '@/lib/haptics';
import { useBookingDraftStore } from '@/booking/store';

// Emotional confirmation (spec §16) rather than a bare transactional
// receipt — that still lives at (details)/receipt/[ref].tsx, reachable from
// "View Booking" below for the full record/QR code.
export default function BookingConfirmationStep() {
  const theme = useTheme();
  const { centreId, ref, totalEuro } = useLocalSearchParams<{ centreId: string; ref: string; totalEuro: string }>();
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const draft = useBookingDraftStore();

  useEffect(() => {
    hapticSuccess();
  }, []);

  const centreQuery = useQuery({ queryKey: ['centre', centreId], queryFn: () => fetchCentre(centreId) });
  const centre = centreQuery.data;

  async function handleAddToCalendar() {
    try {
      await addToCalendar({ title: centre?.name ? `Booking: ${centre.name}` : 'Room booking', date: draft.date ?? new Date().toISOString().slice(0, 10), notes: `Ref: ${ref}` });
      setCalendarStatus('Added to your calendar.');
    } catch {
      setCalendarStatus("Couldn't add to calendar — check calendar permission in Settings.");
    }
  }

  function handleGetDirections() {
    if (centre?.lat == null || centre?.lng == null) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${centre.lat},${centre.lng}`);
  }

  function handleShare() {
    Share.share({ message: `I'm booked in at ${centre?.name ?? 'a HelloCircle venue'}${draft.date ? ` on ${draft.date}` : ''}. Ref: ${ref}` });
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.four, alignItems: 'center' }}>
          <ConfirmationBadge />
          <ThemedText type="hero" style={{ textAlign: 'center' }}>
            You&apos;re booked.
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            Your space is ready.
          </ThemedText>

          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            {centre && <ThemedText type="cardHeading">{centre.name}</ThemedText>}
            {draft.date && (
              <ThemedText themeColor="textSecondary">
                {draft.date}
                {draft.time ? ` · ${draft.time}` : ''}
              </ThemedText>
            )}
            <ThemedText themeColor="textSecondary">{draft.guests} {draft.guests === 1 ? 'person' : 'people'}</ThemedText>
            {totalEuro && <ThemedText themeColor="primary">{formatPrice(Number(totalEuro))}</ThemedText>}
            <ThemedText themeColor="textSecondary" style={{ marginTop: 4 }}>
              Ref: {ref}
            </ThemedText>
          </View>

          <View style={{ width: '100%', gap: Spacing.two }}>
            <Button label="View booking" onPress={() => router.push(`/(details)/receipt/${ref}`)} />
            <ActionRow label="Add to calendar" onPress={handleAddToCalendar} />
            {centre?.lat != null && <ActionRow label="Get directions" onPress={handleGetDirections} />}
            <ActionRow label="Share" onPress={handleShare} />
          </View>
          {calendarStatus && <ThemedText themeColor="textSecondary">{calendarStatus}</ThemedText>}

          <Pressable onPress={() => router.push('/explore')} style={{ marginTop: Spacing.three }}>
            <ThemedText type="sectionHeading" style={{ textAlign: 'center' }}>
              Make more of your day
            </ThemedText>
            <ThemedText themeColor="primary" style={{ textAlign: 'center' }}>
              See what else is on nearby →
            </ThemedText>
          </Pressable>

          <Pressable onPress={() => router.replace('/(tabs)/my-life')}>
            <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
              Done
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.actionRow, { borderColor: theme.border }]}>
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.four,
    gap: 4,
  },
  actionRow: {
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
