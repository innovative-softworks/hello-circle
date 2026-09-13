import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchClub } from '@/api/clubs';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AGE_GROUPS } from '@/lib/bookingConstants';

import { useRegistrationDraftStore } from '@/registration/store';

export default function RegistrationDetailsStep() {
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const draft = useRegistrationDraftStore();
  const { data: club } = useQuery({ queryKey: ['club', clubId], queryFn: () => fetchClub(clubId) });

  const isAdult = draft.registrantType === 'adult';

  useEffect(() => {
    // Audience locks the registrant type; only "all" clubs let the user choose.
    if (club?.audience === 'adults') draft.setField('registrantType', 'adult');
    else if (club?.audience === 'kids') draft.setField('registrantType', 'child');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club?.audience]);

  const canContinue = isAdult
    ? draft.childFirst.trim().length > 0 && draft.childLast.trim().length > 0 && draft.email.trim().length > 0 && draft.phone.trim().length > 0
    : draft.childFirst.trim().length > 0 && draft.childLast.trim().length > 0 && draft.gFirst.trim().length > 0 && draft.gLast.trim().length > 0 && draft.email.trim().length > 0 && draft.phone.trim().length > 0;

  function handleNext() {
    router.push({ pathname: '/registration/[clubId]/medical', params: { clubId } });
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="pageHeading">Your details</ThemedText>

          {club?.audience === 'all' && (
            <View style={{ flexDirection: 'row', gap: Spacing.two }}>
              <Chip label="Registering my child" selected={!isAdult} onPress={() => draft.setField('registrantType', 'child')} />
              <Chip label="Registering myself" selected={isAdult} onPress={() => draft.setField('registrantType', 'adult')} />
            </View>
          )}

          <LabeledInput label={isAdult ? 'Your first name' : "Child's first name"} value={draft.childFirst} onChangeText={(text) => draft.setField('childFirst', text)} />
          <LabeledInput label={isAdult ? 'Your last name' : "Child's last name"} value={draft.childLast} onChangeText={(text) => draft.setField('childLast', text)} />

          {!isAdult && (
            <>
              <LabeledInput label="Date of birth (YYYY-MM-DD)" value={draft.dob} onChangeText={(text) => draft.setField('dob', text)} />
              <ThemedText>Age group</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
                {AGE_GROUPS.map((group) => (
                  <Chip key={group} label={group} selected={draft.team === group} onPress={() => draft.setField('team', group)} />
                ))}
              </ScrollView>
              <LabeledInput label="Guardian first name" value={draft.gFirst} onChangeText={(text) => draft.setField('gFirst', text)} />
              <LabeledInput label="Guardian last name" value={draft.gLast} onChangeText={(text) => draft.setField('gLast', text)} />
            </>
          )}

          <LabeledInput label="Email" value={draft.email} onChangeText={(text) => draft.setField('email', text)} keyboardType="email-address" autoCapitalize="none" />
          <LabeledInput label="Phone" value={draft.phone} onChangeText={(text) => draft.setField('phone', text)} keyboardType="phone-pad" />
          <LabeledInput label="Address" value={draft.address} onChangeText={(text) => draft.setField('address', text)} />

          <ThemedText type="sectionHeading">Emergency contact{isAdult ? ' (optional)' : ''}</ThemedText>
          <LabeledInput label="Name" value={draft.ecName} onChangeText={(text) => draft.setField('ecName', text)} />
          <LabeledInput label="Phone" value={draft.ecPhone} onChangeText={(text) => draft.setField('ecPhone', text)} keyboardType="phone-pad" />
          <LabeledInput label="Relationship" value={draft.ecRel} onChangeText={(text) => draft.setField('ecRel', text)} />

          <Button label="Continue" onPress={handleNext} disabled={!canContinue} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function LabeledInput(props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences';
}) {
  const theme = useTheme();
  return (
    <View>
      <ThemedText>{props.label}</ThemedText>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize}
        style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, padding: Spacing.two, color: theme.text }}
      />
    </View>
  );
}
