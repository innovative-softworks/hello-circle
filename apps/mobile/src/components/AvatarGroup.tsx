import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { ThemedText } from '@/components/themed-text';

// Stacked "○ ○ ○ ○ +N" cluster (spec §07/§27/§37) — always driven by a real
// participant/member count, never a fabricated total.
export function AvatarGroup({
  people,
  total,
  size = 28,
  max = 4,
}: {
  people: { imageUrl?: string | null; name: string }[];
  // Real count this group represents — may exceed `people.length` when only
  // a handful of photos were fetched for preview. Overflow (`+N`) is
  // `total - shown`, never invented.
  total?: number;
  size?: number;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const overflow = Math.max((total ?? people.length) - shown.length, 0);

  return (
    <View style={styles.row}>
      {shown.map((person, i) => (
        <View key={`${person.name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -size * 0.35 }}>
          <Avatar imageUrl={person.imageUrl} name={person.name} size={size} />
        </View>
      ))}
      {overflow > 0 && (
        <ThemedText themeColor="textSecondary" style={styles.overflow}>
          +{overflow}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overflow: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: '600',
  },
});
