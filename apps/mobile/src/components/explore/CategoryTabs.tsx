import { ScrollView } from 'react-native';

import { Chip } from '@/components/Chip';
import { Spacing } from '@/constants/theme';

export type Category = 'games' | 'centres' | 'clubs' | 'adventures' | 'experiences' | 'circles';

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'games', label: 'Games' },
  { key: 'centres', label: 'Centres' },
  { key: 'clubs', label: 'Clubs' },
  { key: 'adventures', label: 'Adventures' },
  { key: 'experiences', label: 'Experiences' },
  { key: 'circles', label: 'Circles' },
];

export function CategoryTabs({ value, onChange }: { value: Category; onChange: (category: Category) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
      {CATEGORIES.map((category) => (
        <Chip key={category.key} label={category.label} selected={value === category.key} onPress={() => onChange(category.key)} />
      ))}
    </ScrollView>
  );
}
