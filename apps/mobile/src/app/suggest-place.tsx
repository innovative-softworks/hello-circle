import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { fetchMyPlaceSuggestions, submitPlaceSuggestion } from '@/api/placeSuggestions';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { IRISH_COUNTY_COORDS } from '@/lib/irishCounties';
import { useOnboardingStore } from '@/onboarding/store';

const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort((a, b) => a.localeCompare(b));

// Community submission — anyone (guest or signed in) can suggest a venue
// that isn't listed yet; admin reviews it on web (server/src/routes/
// admin.ts). Ports web's SuggestPlace.tsx onto the same real endpoint.
export default function SuggestPlaceScreen() {
  const theme = useTheme();
  const homeCounty = useOnboardingStore((state) => state.homeCounty);

  const [suggestedName, setSuggestedName] = useState('');
  const [category, setCategory] = useState<'centre' | 'club'>('centre');
  const [area, setArea] = useState('');
  const [county, setCounty] = useState(homeCounty ?? '');
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [showMine, setShowMine] = useState(false);
  const mineQuery = useQuery({ queryKey: ['my-place-suggestions'], queryFn: fetchMyPlaceSuggestions, enabled: showMine });

  async function handleSubmit() {
    if (!suggestedName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPlaceSuggestion({
        suggestedName: suggestedName.trim(),
        category,
        area: area.trim() || undefined,
        county: county || undefined,
        description: description.trim() || undefined,
        contactInfo: contactInfo.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit this suggestion — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenHeader title="Suggest a place" />
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText themeColor="textSecondary">
            Know a community centre or club that isn&apos;t on HelloCircle yet? Tell us about it — our team reviews every
            suggestion, and approved places go live for everyone to find.
          </ThemedText>

          {done ? (
            <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card, padding: Spacing.four, gap: 4 }}>
              <ThemedText type="cardHeading">Thanks — we&apos;ve got it.</ThemedText>
              <ThemedText themeColor="textSecondary">We&apos;ll review {suggestedName.trim()} and publish it once approved.</ThemedText>
              <Button
                label="Submit another"
                variant="secondary"
                onPress={() => {
                  setSuggestedName('');
                  setArea('');
                  setDescription('');
                  setContactInfo('');
                  setDone(false);
                }}
              />
            </View>
          ) : (
            <>
              <LabeledInput label="Place name" value={suggestedName} onChangeText={setSuggestedName} />

              <View style={{ gap: Spacing.one }}>
                <ThemedText>Type</ThemedText>
                <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                  <Chip label="Community centre" selected={category === 'centre'} onPress={() => setCategory('centre')} />
                  <Chip label="Club" selected={category === 'club'} onPress={() => setCategory('club')} />
                </View>
              </View>

              <LabeledInput label="Area (optional)" value={area} onChangeText={setArea} />

              <View style={{ gap: Spacing.one }}>
                <ThemedText>County (optional)</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
                  {COUNTIES.map((c) => (
                    <Chip key={c} label={c} selected={county === c} onPress={() => setCounty(county === c ? '' : c)} />
                  ))}
                </ScrollView>
              </View>

              <LabeledInput label="What makes it worth adding? (optional)" value={description} onChangeText={setDescription} multiline />
              <LabeledInput label="Contact info (optional)" value={contactInfo} onChangeText={setContactInfo} />

              {error && <ThemedText themeColor="danger">{error}</ThemedText>}

              <Button label="Submit suggestion" onPress={handleSubmit} loading={submitting} disabled={!suggestedName.trim()} />
            </>
          )}

          <Button label={showMine ? 'Hide my suggestions' : 'My suggestions'} variant="secondary" onPress={() => setShowMine(!showMine)} />

          {showMine && (
            <View style={{ gap: Spacing.two }}>
              {(mineQuery.data ?? []).length === 0 && !mineQuery.isLoading && (
                <ThemedText themeColor="textSecondary">You haven&apos;t suggested any places yet.</ThemedText>
              )}
              {(mineQuery.data ?? []).map((s) => (
                <View key={s.id} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card, padding: Spacing.three, gap: 2 }}>
                  <ThemedText type="cardHeading">{s.suggestedName}</ThemedText>
                  <ThemedText themeColor="textSecondary">
                    {s.area}
                    {s.county ? `, ${s.county}` : ''}
                  </ThemedText>
                  <ThemedText themeColor={s.status === 'approved' ? 'primary' : s.status === 'rejected' ? 'danger' : 'textSecondary'} style={{ textTransform: 'capitalize' }}>
                    {s.status}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function LabeledInput(props: { label: string; value: string; onChangeText: (text: string) => void; multiline?: boolean }) {
  const theme = useTheme();
  return (
    <View>
      <ThemedText>{props.label}</ThemedText>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        multiline={props.multiline}
        placeholderTextColor={theme.textSecondary}
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: Radius.control,
          padding: Spacing.two,
          color: theme.text,
          minHeight: props.multiline ? 80 : undefined,
          textAlignVertical: props.multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}
