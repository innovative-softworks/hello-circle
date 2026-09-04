import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { searchMakeItHappen } from '@/api/makeItHappen';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DURATION_OPTIONS } from '@/lib/bookingConstants';
import { IRISH_COUNTY_COORDS } from '@/lib/irishCounties';

import { useMakeItHappenStore } from './_store';

const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort((a, b) => a.localeCompare(b));

export default function MakeItHappenSearchScreen() {
  const theme = useTheme();
  const draft = useMakeItHappenStore();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSearch = draft.activityLabel.trim().length > 0 && draft.county.length > 0 && draft.date.length > 0 && draft.time.length > 0;

  async function handleSearch() {
    setSearching(true);
    setError(null);
    try {
      const candidates = await searchMakeItHappen({
        activityLabel: draft.activityLabel,
        county: draft.county,
        date: draft.date,
        time: draft.time,
        duration: draft.duration,
        partySize: draft.partySize,
      });
      draft.setField('candidates', candidates);
      if (!candidates.length) {
        setError('No places found for that activity — try a different date or county.');
        return;
      }
      router.push('/make-it-happen/results');
    } catch {
      setError("Couldn't search right now — please try again.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText themeColor="textSecondary">
            Tell us what you want to do and we&apos;ll find a real place with space for it.
          </ThemedText>

          <View>
            <ThemedText>What do you want to do?</ThemedText>
            <TextInput
              value={draft.activityLabel}
              onChangeText={(text) => draft.setField('activityLabel', text)}
              placeholder="e.g. Five-a-side football"
              placeholderTextColor={theme.textSecondary}
              style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: Spacing.two, color: theme.text }}
            />
          </View>

          <ThemedText>County</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
            {COUNTIES.map((county) => (
              <Chip key={county} label={county} selected={draft.county === county} onPress={() => draft.setField('county', county)} />
            ))}
          </ScrollView>

          <LabeledInput label="Date (YYYY-MM-DD)" value={draft.date} onChangeText={(text) => draft.setField('date', text)} />
          <LabeledInput label="Time (HH:MM)" value={draft.time} onChangeText={(text) => draft.setField('time', text)} />

          <ThemedText>Duration</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
            {DURATION_OPTIONS.map((option) => (
              <Chip key={option.hours} label={option.label} selected={draft.duration === option.hours} onPress={() => draft.setField('duration', option.hours)} />
            ))}
          </ScrollView>

          <View>
            <ThemedText>Party size</ThemedText>
            <TextInput
              value={String(draft.partySize)}
              onChangeText={(text) => draft.setField('partySize', Math.max(1, parseInt(text, 10) || 1))}
              keyboardType="number-pad"
              style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: Spacing.two, color: theme.text }}
            />
          </View>

          {error && <ThemedText themeColor="danger">{error}</ThemedText>}

          <Button label="Find a place" onPress={handleSearch} loading={searching} disabled={!canSearch} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function LabeledInput(props: { label: string; value: string; onChangeText: (text: string) => void }) {
  const theme = useTheme();
  return (
    <View>
      <ThemedText>{props.label}</ThemedText>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholderTextColor={theme.textSecondary}
        style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: Spacing.two, color: theme.text }}
      />
    </View>
  );
}
