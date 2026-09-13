import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMyResidentProfile, updateResidentMe } from '@/api/residents';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { CountyPickerSheet } from '@/components/CountyPickerSheet';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

// Ports web's Profile.tsx edit section — only name + homeCounty are
// editable server-side (PUT /residents/me); there's no bio/photo field on
// the resident record. "Revisit interests & availability" re-enters the
// same onboarding screens web uses (navigate("/onboarding")) rather than a
// separate edit form — the onboarding store already holds current answers
// and complete() is idempotent, so this is a safe, real re-run, not a reset.
export default function EditProfileScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const county = useOnboardingStore((state) => state.homeCounty);
  const countySheetRef = useRef<BottomSheetModal>(null);

  const { data } = useQuery({ queryKey: ['my-resident-profile'], queryFn: fetchMyResidentProfile, enabled: signedIn });
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed the name field once the profile loads, without a useEffect —
  // adjusting state during render (per React's own guidance for "state
  // that changes when a prop changes") avoids an extra render pass.
  const [loadedName, setLoadedName] = useState<string | null>(null);
  if (data?.resident && data.resident.name !== loadedName) {
    setLoadedName(data.resident.name);
    setName(data.resident.name);
  }

  if (!signedIn) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <ScreenHeader title="Edit Profile" />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
            <ThemedText themeColor="textSecondary">Sign in to edit your profile.</ThemedText>
            <Button label="Sign in" onPress={() => router.push('/auth/sign-in')} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateResidentMe({ name: name.trim(), homeCounty: county ?? undefined });
      queryClient.invalidateQueries({ queryKey: ['my-resident-profile'] });
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenHeader title="Edit Profile" />
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          {error && <ThemedText themeColor="danger">{error}</ThemedText>}
          {saved && <ThemedText themeColor="primary">Saved.</ThemedText>}

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="metadata">Name</ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholderTextColor={theme.textSecondary}
              style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, padding: Spacing.two, color: theme.text }}
            />
          </View>

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="metadata">Home county</ThemedText>
            <Pressable
              onPress={() => countySheetRef.current?.present()}
              style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, padding: Spacing.two }}>
              <ThemedText>{county ?? 'Not set'}</ThemedText>
            </Pressable>
          </View>

          <Button label="Save changes" onPress={handleSave} loading={saving} disabled={!name.trim()} />

          <Pressable onPress={() => router.push('/onboarding/interests')} style={{ marginTop: Spacing.three }}>
            <ThemedText themeColor="primary">Revisit interests & availability →</ThemedText>
          </Pressable>
        </ScrollView>

        <CountyPickerSheet ref={countySheetRef} />
      </SafeAreaView>
    </ThemedView>
  );
}
