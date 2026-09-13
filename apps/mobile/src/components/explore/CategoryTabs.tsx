import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Category = 'games' | 'centres' | 'clubs' | 'adventures' | 'experiences' | 'circles';

const CATEGORIES: { key: Category; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'games', label: 'Games', icon: 'football-outline' },
  { key: 'centres', label: 'Places', icon: 'business-outline' },
  { key: 'clubs', label: 'Clubs', icon: 'people-outline' },
  { key: 'adventures', label: 'Adventures', icon: 'compass-outline' },
  { key: 'experiences', label: 'Experiences', icon: 'sparkles-outline' },
  { key: 'circles', label: 'Circles', icon: 'people-circle-outline' },
];

// Icon-tile category browse (spec's Explore icon grid) — same real 6
// categories this backend has data for, just a richer visual than a plain
// chip row.
export function CategoryTabs({ value, onChange }: { value: Category; onChange: (category: Category) => void }) {
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.three, paddingHorizontal: Spacing.four }}>
      {CATEGORIES.map((category) => {
        const selected = value === category.key;
        return (
          <Pressable key={category.key} onPress={() => onChange(category.key)} style={{ alignItems: 'center', gap: Spacing.one, width: 64 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: Radius.card,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? theme.primary : theme.backgroundSelected,
              }}>
              <Ionicons name={category.icon} size={24} color={selected ? '#fff' : theme.textSecondary} />
            </View>
            <ThemedText type="metadata" style={{ textAlign: 'center' }} numberOfLines={1}>
              {category.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
