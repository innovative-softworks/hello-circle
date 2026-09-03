import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { fetchMyCircles } from '@/api/circles';
import { useAuthStore } from '@/auth/store';
import { ThemedText } from '@/components/themed-text';
import { SectionHeader } from '@/components/home/SectionHeader';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function YourCircles() {
  const theme = useTheme();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const { data } = useQuery({
    queryKey: ['my-circles'],
    queryFn: fetchMyCircles,
    enabled: signedIn,
  });

  if (!signedIn || !data?.length) return null;

  return (
    <>
      <SectionHeader title="Your Circles" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.four }}>
        {data.map((circle) => (
          <Pressable
            key={circle.id}
            onPress={() => router.push(`/(details)/circle/${circle.id}`)}
            style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.title} numberOfLines={1}>
              {circle.name}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.small}>
              {circle.members} members
            </ThemedText>
            {circle.nextPlan && (
              <ThemedText themeColor="primary" style={styles.small}>
                Next: {circle.nextPlan.date}
              </ThemedText>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 180,
    borderRadius: 16,
    borderWidth: 1,
    padding: Spacing.three,
    gap: 2,
  },
  title: {
    fontWeight: '700',
    fontSize: 14,
  },
  small: {
    fontSize: 12,
  },
});
