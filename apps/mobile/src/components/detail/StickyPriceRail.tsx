import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Real as of Phase 3 — onPress starts the booking/registration flow. Kept
// as a Pressable-or-disabled-View so a caller that has nothing to wire yet
// (none remain, but this is why the shape stayed) can still render a
// styled-but-inert rail rather than a dead route. `loading` (Experience
// Detail redesign) covers join/leave/waitlist calls that hit the network —
// without it a double-tap during a pending Stripe checkout was possible.
export function StickyPriceRail({
  priceLabel,
  ctaLabel,
  onPress,
  loading,
}: {
  priceLabel: string;
  ctaLabel: string;
  onPress?: () => void;
  loading?: boolean;
}) {
  const theme = useTheme();
  const Container = onPress && !loading ? Pressable : View;
  return (
    <View style={[styles.rail, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText style={styles.price}>{priceLabel}</ThemedText>
      <Container
        onPress={loading ? undefined : onPress}
        style={[styles.button, { backgroundColor: onPress ? theme.primary : theme.border, opacity: loading ? 0.7 : 1 }]}>
        {loading ? <ActivityIndicator color="#fff" /> : <ThemedText style={[styles.buttonLabel, { color: onPress ? '#fff' : theme.textSecondary }]}>{ctaLabel}</ThemedText>}
      </Container>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    padding: Spacing.three,
  },
  price: {
    fontWeight: '700',
    fontSize: 16,
  },
  button: {
    borderRadius: Radius.control,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontWeight: '700',
  },
});
