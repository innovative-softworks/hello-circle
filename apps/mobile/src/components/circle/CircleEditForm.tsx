import type { Circle } from '@hello-circle/types';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import type { CircleJoinMode } from '@/api/circles';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface CircleEditValues {
  name: string;
  about: string;
  whatWeDo: string;
  whoCanJoin: string;
  joinMode: CircleJoinMode;
}

// Exported so circles/new.tsx's lighter-weight "Start a Circle" flow can
// reuse the same picker rather than duplicating the label copy.
export const JOIN_MODES: { value: CircleJoinMode; label: string }[] = [
  { value: 'open', label: 'Open — anyone can join' },
  { value: 'approval', label: 'Approval — organiser reviews requests' },
  { value: 'invite', label: 'Invite only' },
];

// Only exposes the fields a mobile organiser is likely to touch day-to-day
// (name/about/what-we-do/who-can-join/join mode). The screen that owns this
// form (circle/[id]/edit.tsx) merges activityLabel/area/county/centreId/
// imageUrl from the original circle back into the submission, since
// PUT /circles/:id overwrites the full row.
export function CircleEditForm({
  circle,
  onSubmit,
  submitting,
  error,
}: {
  circle: Circle;
  onSubmit: (values: CircleEditValues) => void;
  submitting: boolean;
  error?: string | null;
}) {
  const [values, setValues] = useState<CircleEditValues>({
    name: circle.name,
    about: circle.about,
    whatWeDo: circle.whatWeDo ?? '',
    whoCanJoin: circle.whoCanJoin ?? '',
    joinMode: circle.joinMode,
  });

  function setField<K extends keyof CircleEditValues>(key: K, value: CircleEditValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const canSubmit = values.name.trim().length > 0;

  return (
    <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}

      <LabeledInput label="Name" value={values.name} onChangeText={(text) => setField('name', text)} />
      <LabeledInput label="About" value={values.about} onChangeText={(text) => setField('about', text)} multiline />
      <LabeledInput label="What we do" value={values.whatWeDo} onChangeText={(text) => setField('whatWeDo', text)} multiline />
      <LabeledInput label="Who can join" value={values.whoCanJoin} onChangeText={(text) => setField('whoCanJoin', text)} multiline />

      <View>
        <ThemedText>Join mode</ThemedText>
        <View style={{ gap: Spacing.two, paddingVertical: Spacing.one }}>
          {JOIN_MODES.map((mode) => (
            <Chip key={mode.value} label={mode.label} selected={values.joinMode === mode.value} onPress={() => setField('joinMode', mode.value)} />
          ))}
        </View>
      </View>

      <Button label="Save changes" onPress={() => onSubmit(values)} disabled={!canSubmit} loading={submitting} />
    </ScrollView>
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
          minHeight: props.multiline ? 60 : undefined,
        }}
      />
    </View>
  );
}
