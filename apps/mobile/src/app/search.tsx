import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { search } from '@/api/search';
import { Chip } from '@/components/Chip';
import type { Category } from '@/components/explore/CategoryTabs';
import { CompactActivityRow } from '@/components/explore/CompactActivityRow';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonList } from '@/components/SkeletonLoader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPrice, formatPriceCents } from '@/lib/format';
import { useRecentSearchStore } from '@/search/store';

// spec §29 — searches centres/clubs/activities/experiences via the same
// /api/search endpoint Explore's text search already uses, grouped by
// type. No "trending nearby" section: there's no backing endpoint for it,
// and this app doesn't fake data — suggested categories link into Explore
// instead, which does real category browsing.
const SUGGESTED: { key: Category; label: string }[] = [
  { key: 'games', label: 'Games' },
  { key: 'centres', label: 'Places' },
  { key: 'clubs', label: 'Clubs' },
  { key: 'circles', label: 'Circles' },
  { key: 'adventures', label: 'Adventures' },
  { key: 'experiences', label: 'Experiences' },
];

export default function SearchScreen() {
  const theme = useTheme();
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const recent = useRecentSearchStore((state) => state.queries);
  const addRecent = useRecentSearchStore((state) => state.add);
  const clearRecent = useRecentSearchStore((state) => state.clear);

  const searchQuery = useQuery({ queryKey: ['global-search', submitted], queryFn: () => search(submitted), enabled: submitted.length > 0 });

  function runSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setQ(trimmed);
    setSubmitted(trimmed);
    addRecent(trimmed);
  }

  const data = searchQuery.data;
  const hasResults = !!data && (data.centres.length > 0 || data.clubs.length > 0 || data.activities.length > 0 || data.experiences.length > 0);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={{ paddingHorizontal: Spacing.four, gap: Spacing.three }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
              borderRadius: 12,
              paddingHorizontal: 14,
              height: 44,
            }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              onSubmitEditing={() => runSearch(q)}
              autoFocus
              returnKeyType="search"
              placeholder="Search activities, places, circles…"
              placeholderTextColor={theme.textSecondary}
              style={{ flex: 1, fontSize: 16, color: theme.text }}
            />
            {q.length > 0 && (
              <Pressable
                onPress={() => {
                  setQ('');
                  setSubmitted('');
                }}
                hitSlop={8}>
                <ThemedText themeColor="textSecondary">✕</ThemedText>
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <ThemedText themeColor="primary">Cancel</ThemedText>
          </Pressable>
          </View>
        </View>

        {submitted.length === 0 ? (
          <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.four }}>
            {recent.length > 0 && (
              <View style={{ gap: Spacing.two }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText type="eyebrow">Recent searches</ThemedText>
                  <Pressable onPress={clearRecent}>
                    <ThemedText themeColor="textSecondary">Clear</ThemedText>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
                  {recent.map((query) => (
                    <Chip key={query} label={query} selected={false} onPress={() => runSearch(query)} />
                  ))}
                </View>
              </View>
            )}

            <View style={{ gap: Spacing.two }}>
              <ThemedText type="eyebrow">Browse by category</ThemedText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
                {SUGGESTED.map((s) => (
                  <Chip
                    key={s.key}
                    label={s.label}
                    selected={false}
                    onPress={() => router.push({ pathname: '/explore', params: { category: s.key } })}
                  />
                ))}
              </View>
            </View>
          </ScrollView>
        ) : searchQuery.isLoading ? (
          <View style={{ paddingTop: Spacing.three }}>
            <SkeletonList />
          </View>
        ) : !hasResults ? (
          <EmptyState icon="search-outline" title={`No results for "${submitted}"`} description="Try a different search, or browse by category." />
        ) : (
          <ScrollView contentContainerStyle={{ paddingTop: Spacing.two, paddingBottom: Spacing.four }}>
            {data!.centres.length > 0 && (
              <ResultGroup title="Places">
                {data!.centres.map((c) => (
                  <CompactActivityRow
                    key={c.id}
                    imageUrl={c.image}
                    category="Place"
                    title={c.name}
                    metadata={`${c.area}, ${c.county}`}
                    price={`From ${formatPrice(c.from)}/hr`}
                    onPress={() => router.push(`/(details)/centre/${c.id}`)}
                  />
                ))}
              </ResultGroup>
            )}
            {data!.clubs.length > 0 && (
              <ResultGroup title="Clubs">
                {data!.clubs.map((c) => (
                  <CompactActivityRow
                    key={c.id}
                    imageUrl={c.image}
                    category="Club"
                    title={c.name}
                    metadata={`${c.area}, ${c.county}`}
                    price={`${formatPrice(c.price)}/${c.unit}`}
                    onPress={() => router.push(`/(details)/club/${c.id}`)}
                  />
                ))}
              </ResultGroup>
            )}
            {data!.activities.length > 0 && (
              <ResultGroup title="Activities">
                {data!.activities.map((item) => (
                  <CompactActivityRow
                    key={item.id}
                    imageUrl={item.imageUrl}
                    category={item.isLive ? 'Live now' : 'Activity'}
                    title={item.title}
                    metadata={[item.centreName ?? item.clubName, item.area].filter(Boolean).join(' · ')}
                    price={formatPriceCents(item.priceCents)}
                    onPress={item.kind === 'game' ? () => router.push(`/(details)/game/${item.id}`) : undefined}
                  />
                ))}
              </ResultGroup>
            )}
            {data!.experiences.length > 0 && (
              <ResultGroup title="Experiences">
                {data!.experiences.map((experience) => (
                  <CompactActivityRow key={experience.id} imageUrl={null} category="Experience" title={experience.title} metadata="" />
                ))}
              </ResultGroup>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function ResultGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: Spacing.three }}>
      <ThemedText type="eyebrow" style={{ paddingHorizontal: Spacing.four, marginBottom: Spacing.one }}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}
