import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Button({
  label,
  onPress,
  loading,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  // 'secondary' is an outline button for pairing with a primary CTA (e.g.
  // booking review screens) — same shape/spacing, no fill.
  variant?: 'primary' | 'secondary';
}) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const [pressed, setPressed] = useState(false);
  const isSecondary = variant === 'secondary';

  // Plain static style array, not a `style={({pressed}) => [...]}` function
  // — on this exact RN/Fabric build, a function-valued `style` prop on
  // Pressable silently fails to apply any styles at all (confirmed: the
  // label text rendered with zero background, on every screen using this
  // component, while StickyPriceRail's near-identical button — which uses
  // a plain array style — rendered correctly). Press feedback is tracked
  // via onPressIn/onPressOut instead.
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={isDisabled}
      style={[
        styles.button,
        isSecondary
          ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.border }
          : { backgroundColor: theme.primary },
        { opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1 },
      ]}>
      {loading ? (
        <ActivityIndicator color={isSecondary ? theme.text : '#fff'} />
      ) : (
        <Text style={[styles.label, { color: isSecondary ? theme.text : '#fff' }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
  },
});
