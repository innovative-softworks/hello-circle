import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchCentre } from '@/api/centres';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPrice } from '@/lib/format';

import { useBookingDraftStore } from './_store';

export default function RoomStep() {
  const { centreId } = useLocalSearchParams<{ centreId: string }>();
  const theme = useTheme();
  const setField = useBookingDraftStore((state) => state.setField);
  const { data: centre } = useQuery({ queryKey: ['centre', centreId], queryFn: () => fetchCentre(centreId) });

  const activeRooms = (centre?.rooms ?? []).filter((room) => room.active);

  useEffect(() => {
    // Auto-skip when there's only one active room — every centre has >=1
    // active room per CLAUDE.md's invariant, matching web's auto-skip.
    if (activeRooms.length === 1) {
      setField('roomId', activeRooms[0].id);
      router.replace({ pathname: '/booking/[centreId]/date-time', params: { centreId } });
    }
  }, [activeRooms, centreId, setField]);

  if (!centre || activeRooms.length <= 1) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  function handleSelect(roomId: string) {
    setField('roomId', roomId);
    router.push({ pathname: '/booking/[centreId]/date-time', params: { centreId } });
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.two }}>
          {activeRooms.map((room) => (
            <Pressable key={room.id} onPress={() => handleSelect(room.id)} style={[styles.row, { borderColor: theme.border }]}>
              <ThemedText style={styles.title}>{room.name}</ThemedText>
              <ThemedText themeColor="textSecondary">
                Up to {room.cap} guests · {formatPrice(room.rate)}/hr
              </ThemedText>
              {room.desc.length > 0 && <ThemedText themeColor="textSecondary">{room.desc}</ThemedText>}
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: 2,
  },
  title: {
    fontWeight: '700',
  },
});
