import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { EVENT_TYPES } from '@/lib/bookingConstants';

import { useBookingDraftStore } from './_store';

export default function DetailsStep() {
  const { centreId } = useLocalSearchParams<{ centreId: string }>();
  const theme = useTheme();
  const { eventType, guests, name, email, phone, notes, setField } = useBookingDraftStore();

  const canContinue = eventType.length > 0 && name.trim().length > 0 && email.trim().length > 0 && phone.trim().length > 0;

  function handleNext() {
    router.push({ pathname: '/booking/[centreId]/review', params: { centreId } });
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="subtitle">Event type</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
            {EVENT_TYPES.map((type) => (
              <Chip key={type} label={type} selected={eventType === type} onPress={() => setField('eventType', type)} />
            ))}
          </ScrollView>

          <View>
            <ThemedText>Guests</ThemedText>
            <TextInput
              value={String(guests)}
              onChangeText={(text) => setField('guests', Math.max(1, parseInt(text, 10) || 1))}
              keyboardType="number-pad"
              style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: Spacing.two, color: theme.text }}
            />
          </View>

          <LabeledInput label="Your name" value={name} onChangeText={(text) => setField('name', text)} />
          <LabeledInput label="Email" value={email} onChangeText={(text) => setField('email', text)} keyboardType="email-address" autoCapitalize="none" />
          <LabeledInput label="Phone" value={phone} onChangeText={(text) => setField('phone', text)} keyboardType="phone-pad" />
          <LabeledInput label="Notes (optional)" value={notes} onChangeText={(text) => setField('notes', text)} multiline />

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
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences';
  multiline?: boolean;
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
        multiline={props.multiline}
        placeholderTextColor={theme.textSecondary}
        style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: Spacing.two, color: theme.text, minHeight: props.multiline ? 60 : undefined }}
      />
    </View>
  );
}
