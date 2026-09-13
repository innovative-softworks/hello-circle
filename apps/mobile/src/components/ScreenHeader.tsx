import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// One shared back-arrow + title header for every pushed (non-tab, non-hero)
// screen — a consistency pass found several (Saved, Following, Settings,
// Edit Profile, Notifications, Profile) had `headerShown: false` at the
// layout level with no back affordance in the screen itself at all, unlike
// every onboarding/auth screen and going.tsx, which already built this
// exact row by hand. Hero screens (centre/circle/game/club detail) keep
// their own back button inside ImmersiveHero — this is for plain screens.
export function ScreenHeader({ title, action }: { title: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four }}>
      <Pressable onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="arrow-back" size={24} color={theme.text} />
      </Pressable>
      <ThemedText type="pageHeading" style={{ flex: 1 }}>
        {title}
      </ThemedText>
      {action}
    </View>
  );
}
