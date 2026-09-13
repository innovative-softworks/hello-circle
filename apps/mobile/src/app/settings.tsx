import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '@/auth/store';
import { CountyPickerSheet } from '@/components/CountyPickerSheet';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

// spec §24 — simple editorial list, no cards. Items with nothing real to
// manage yet (Payments — Stripe Checkout is hosted, there's no saved-card
// API; Language/Accessibility — no i18n or a11y-preference store) show an
// honest static line instead of a dead-end tap target.
export default function SettingsScreen() {
  const theme = useTheme();
  const email = useAuthStore((state) => state.email);
  const signOut = useAuthStore((state) => state.signOut);
  const county = useOnboardingStore((state) => state.homeCounty);
  const locationSheetRef = useRef<BottomSheetModal>(null);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenHeader title="Settings" />
        <ScrollView contentContainerStyle={{ paddingVertical: Spacing.three }}>
          <Section title="Account">
            <StaticRow label="Email" value={email ?? 'Not signed in'} />
          </Section>

          <Section title="Preferences">
            <Row label="Location" value={county ?? 'Not set'} onPress={() => locationSheetRef.current?.present()} />
            <Row label="Notifications" onPress={() => router.push('/notifications')} />
            <StaticRow label="Payments" value="Managed securely by Stripe at checkout — no saved cards" />
            <StaticRow label="Language" value="English (Ireland)" />
            <StaticRow label="Accessibility" value="Follows your device's text size and contrast settings" />
          </Section>

          <Section title="Community">
            <Row label="Ask HelloCircle" onPress={() => router.push('/ask')} />
            <Row label="Suggest a place" onPress={() => router.push('/suggest-place')} />
          </Section>

          <Section title="About">
            <Row label="Privacy" value="hellocircle.ie/privacy" onPress={() => Linking.openURL('https://hellocircle.ie/privacy')} />
            <StaticRow label="Help & Support" value="Contact your centre or club directly, or reach us via the app store listing" />
            <StaticRow label="About HelloCircle" value="Good People. Brighter Places." />
          </Section>

          <Pressable onPress={signOut} style={[styles.row, { borderColor: theme.border }]}>
            <ThemedText themeColor="danger">Log Out</ThemedText>
          </Pressable>
        </ScrollView>

        <CountyPickerSheet ref={locationSheetRef} />
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: Spacing.four }}>
      <ThemedText type="eyebrow" style={{ paddingHorizontal: Spacing.four, marginBottom: Spacing.one }}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function Row({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.row, { borderColor: theme.border }]}>
      <ThemedText>{label}</ThemedText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }}>
        {value && <ThemedText themeColor="textSecondary">{value}</ThemedText>}
        <ThemedText themeColor="textSecondary">→</ThemedText>
      </View>
    </Pressable>
  );
}

function StaticRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderColor: theme.border }]}>
      <ThemedText>{label}</ThemedText>
      <ThemedText themeColor="textSecondary" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
  },
});
