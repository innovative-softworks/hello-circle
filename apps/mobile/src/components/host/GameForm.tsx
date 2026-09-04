import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import type { CreateGameInput } from '@/api/games';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SKILL_LEVELS } from '@/lib/bookingConstants';

// Shared by host/games/new.tsx (create) and host/games/[id]/edit.tsx (edit)
// — same field set as server/src/routes/games.ts's CreateGameInput, minus
// the handful of fields this MVP doesn't expose (confirmationDeadline,
// equipmentNeeded, minAge, surfaceType, indoorOutdoor, meetingInstructions,
// cancellationPolicy, centreId). The edit screen preserves those by merging
// the original game's values back in before calling updateGame() — see
// gameFormValuesToInput()'s `base` param — so editing never silently wipes
// a field this form doesn't show.
export interface GameFormValues {
  activityLabel: string;
  locationText: string;
  date: string;
  time: string;
  capacity: string;
  skillLevel: string;
  priceCents: string;
  visibility: 'public' | 'invite';
  soloFriendly: boolean;
  minParticipants: string;
  description: string;
  durationMinutes: string;
}

export const EMPTY_GAME_FORM: GameFormValues = {
  activityLabel: '',
  locationText: '',
  date: '',
  time: '',
  capacity: '',
  skillLevel: '',
  priceCents: '',
  visibility: 'public',
  soloFriendly: false,
  minParticipants: '',
  description: '',
  durationMinutes: '',
};

export function gameFormValuesToInput(values: GameFormValues, base?: Partial<CreateGameInput>): CreateGameInput {
  return {
    ...(base ?? {}),
    activityLabel: values.activityLabel.trim(),
    locationText: values.locationText.trim(),
    date: values.date.trim(),
    time: values.time.trim(),
    capacity: parseInt(values.capacity, 10),
    skillLevel: values.skillLevel || undefined,
    priceCents: values.priceCents ? Math.round(parseFloat(values.priceCents) * 100) : undefined,
    visibility: values.visibility,
    soloFriendly: values.soloFriendly,
    minParticipants: values.minParticipants ? parseInt(values.minParticipants, 10) : undefined,
    description: values.description.trim() || undefined,
    durationMinutes: values.durationMinutes ? parseInt(values.durationMinutes, 10) : undefined,
  };
}

export function GameForm({
  initial,
  submitLabel,
  onSubmit,
  submitting,
  error,
}: {
  initial: GameFormValues;
  submitLabel: string;
  onSubmit: (values: GameFormValues) => void;
  submitting: boolean;
  error?: string | null;
}) {
  const [values, setValues] = useState(initial);
  const [showMore, setShowMore] = useState(false);

  function setField<K extends keyof GameFormValues>(key: K, value: GameFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const canSubmit = values.activityLabel.trim().length > 0 && values.date.trim().length > 0 && values.time.trim().length > 0 && parseInt(values.capacity, 10) > 0;

  return (
    <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}

      <LabeledInput label="Activity" value={values.activityLabel} onChangeText={(text) => setField('activityLabel', text)} placeholder="e.g. 5-a-side football" />
      <LabeledInput label="Location" value={values.locationText} onChangeText={(text) => setField('locationText', text)} placeholder="Where is this happening?" />
      <LabeledInput label="Date" value={values.date} onChangeText={(text) => setField('date', text)} placeholder="YYYY-MM-DD" />
      <LabeledInput label="Time" value={values.time} onChangeText={(text) => setField('time', text)} placeholder="HH:MM" />
      <LabeledInput label="Capacity" value={values.capacity} onChangeText={(text) => setField('capacity', text)} keyboardType="number-pad" />

      <Pressable onPress={() => setShowMore((prev) => !prev)}>
        <ThemedText themeColor="primary">{showMore ? 'Hide more options' : 'More options'}</ThemedText>
      </Pressable>

      {showMore && (
        <View style={{ gap: Spacing.three }}>
          <View>
            <ThemedText>Skill level</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingVertical: Spacing.one }}>
              {SKILL_LEVELS.map((level) => (
                <Chip key={level} label={level} selected={values.skillLevel === level} onPress={() => setField('skillLevel', level)} />
              ))}
            </ScrollView>
          </View>

          <View>
            <ThemedText>Who can see this</ThemedText>
            <View style={{ flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one }}>
              <Chip label="Public" selected={values.visibility === 'public'} onPress={() => setField('visibility', 'public')} />
              <Chip label="Invite only" selected={values.visibility === 'invite'} onPress={() => setField('visibility', 'invite')} />
            </View>
          </View>

          <LabeledInput label="Price in EUR (optional)" value={values.priceCents} onChangeText={(text) => setField('priceCents', text)} keyboardType="decimal-pad" />
          <LabeledInput label="Minimum players (optional)" value={values.minParticipants} onChangeText={(text) => setField('minParticipants', text)} keyboardType="number-pad" />
          <LabeledInput label="Duration in minutes (optional)" value={values.durationMinutes} onChangeText={(text) => setField('durationMinutes', text)} keyboardType="number-pad" />
          <LabeledInput label="Description (optional)" value={values.description} onChangeText={(text) => setField('description', text)} multiline />

          <View style={styles.switchRow}>
            <ThemedText>Solo-friendly</ThemedText>
            <Switch value={values.soloFriendly} onValueChange={(value) => setField('soloFriendly', value)} />
          </View>
        </View>
      )}

      <Button label={submitLabel} onPress={() => onSubmit(values)} disabled={!canSubmit} loading={submitting} />
    </ScrollView>
  );
}

function LabeledInput(props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  multiline?: boolean;
}) {
  const theme = useTheme();
  return (
    <View>
      <ThemedText>{props.label}</ThemedText>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={theme.textSecondary}
        keyboardType={props.keyboardType}
        multiline={props.multiline}
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: Spacing.two,
          color: theme.text,
          minHeight: props.multiline ? 60 : undefined,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
