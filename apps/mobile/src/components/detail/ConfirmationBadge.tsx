import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// One shared "You're confirmed" checkmark badge for every emotional
// confirmation screen (booking/registration/game join/Make It Happen) — a
// design-consistency pass found each had independently built its own
// version (two sizes, a Unicode "✓" glyph vs a real Ionicons icon).
export function ConfirmationBadge({ size = 88 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary }}>
      <Ionicons name="checkmark" size={Math.round(size * 0.55)} color="#fff" />
    </View>
  );
}
