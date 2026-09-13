import type { MyExperienceBooking } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPriceCents } from '@/lib/format';

const PREVIEW_LIMIT = 3;

// Adventures & Experiences bookings — a separate fetch from the unified
// participation feed (see api/experiences.ts's fetchMyExperienceBookings
// comment), so this gets its own section rather than being merged into
// ParticipationSection's typed ParticipationEntry list.
export function ExperienceBookingsSection({ bookings }: { bookings: MyExperienceBooking[] }) {
  const theme = useTheme();
  if (!bookings.length) return null;

  const preview = [...bookings].sort((a, b) => b.date.localeCompare(a.date)).slice(0, PREVIEW_LIMIT);

  return (
    <View style={styles.section}>
      <ThemedText type="sectionHeading">Adventures &amp; Experiences</ThemedText>
      {preview.map((booking) => (
        <Pressable
          key={booking.ref}
          onPress={() => router.push(`/(details)/experience/${booking.experienceId}`)}
          style={[styles.row, { borderColor: theme.border }]}>
          <ThemedText type="cardHeading" numberOfLines={1}>
            {booking.title}
          </ThemedText>
          <ThemedText themeColor="textSecondary" numberOfLines={1}>
            {booking.date} at {booking.time} · party of {booking.partySize}
          </ThemedText>
          <ThemedText themeColor={booking.status === 'cancelled' ? 'danger' : 'primary'}>
            {booking.status === 'cancelled' ? 'Cancelled' : formatPriceCents(booking.totalCents)}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  row: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: 2,
  },
});
