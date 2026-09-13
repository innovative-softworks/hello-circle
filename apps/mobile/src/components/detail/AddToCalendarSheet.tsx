import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { forwardRef, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { addToCalendarById, fetchWritableCalendars, type CalendarAccount, type CalendarEventInput } from '@/lib/calendar';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Real device calendar accounts (see calendar.ts) — never a fabricated
// Apple/Google/Outlook chooser; a resident with one local calendar sees
// exactly one row here.
function iconForSource(sourceName: string): keyof typeof Ionicons.glyphMap {
  const key = sourceName.toLowerCase();
  if (key.includes('google')) return 'logo-google';
  if (key.includes('outlook') || key.includes('exchange') || key.includes('office')) return 'business-outline';
  if (key.includes('icloud') || key.includes('apple') || key.includes('default')) return 'logo-apple';
  return 'calendar-outline';
}

export const AddToCalendarSheet = forwardRef<
  BottomSheetModal,
  { event: CalendarEventInput; eventLink: string; onStatus: (message: string) => void }
>(function AddToCalendarSheet({ event, eventLink, onStatus }, ref) {
  const theme = useTheme();
  const [calendars, setCalendars] = useState<CalendarAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWritableCalendars()
      .then(setCalendars)
      .catch(() => setError("Couldn't access your calendars — check permission in Settings."));
  }, []);

  async function handlePick(calendar: CalendarAccount) {
    try {
      await addToCalendarById(calendar.id, event);
      onStatus(`Added to ${calendar.title}.`);
      if (ref && 'current' in ref) ref.current?.dismiss();
    } catch {
      onStatus("Couldn't add to calendar — please try again.");
    }
  }

  async function handleCopyLink() {
    await Clipboard.setStringAsync(eventLink);
    onStatus('Link copied.');
    if (ref && 'current' in ref) ref.current?.dismiss();
  }

  return (
    <BottomSheetModal ref={ref} snapPoints={['50%']} backgroundStyle={{ backgroundColor: theme.background }}>
      <BottomSheetView style={styles.content}>
        <ThemedText type="sectionHeading">Add to Calendar</ThemedText>

        {error && <ThemedText themeColor="danger">{error}</ThemedText>}
        {!error && !calendars && <ThemedText themeColor="textSecondary">Loading your calendars…</ThemedText>}
        {calendars?.length === 0 && <ThemedText themeColor="textSecondary">No writable calendar found on this device.</ThemedText>}

        {calendars?.map((calendar) => (
          <Pressable key={calendar.id} onPress={() => handlePick(calendar)} style={[styles.row, { borderColor: theme.border }]}>
            <Ionicons name={iconForSource(calendar.sourceName)} size={20} color={theme.text} />
            <View style={{ flex: 1 }}>
              <ThemedText>{calendar.sourceName}</ThemedText>
              {calendar.title !== calendar.sourceName && (
                <ThemedText type="metadata">{calendar.title}</ThemedText>
              )}
            </View>
          </Pressable>
        ))}

        <Pressable onPress={handleCopyLink} style={[styles.row, { borderColor: theme.border }]}>
          <Ionicons name="link-outline" size={20} color={theme.text} />
          <ThemedText style={{ flex: 1 }}>Copy event link</ThemedText>
        </Pressable>

        <Pressable onPress={() => ref && 'current' in ref && ref.current?.dismiss()} style={{ alignItems: 'center', padding: Spacing.three }}>
          <ThemedText themeColor="textSecondary">Cancel</ThemedText>
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.three,
  },
});
