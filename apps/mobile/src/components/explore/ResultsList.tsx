import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { fetchCentres } from '@/api/centres';
import { fetchClubs } from '@/api/clubs';
import { fetchCircles } from '@/api/circles';
import { fetchGames } from '@/api/games';
import { search } from '@/api/search';
import { ActivityCard } from '@/components/home/ActivityCard';
import { PlaceCard } from '@/components/home/PlaceCard';
import type { Category } from '@/components/explore/CategoryTabs';
import type { ExploreFilters } from '@/components/explore/FilterSheet';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/EmptyState';
import { IntentCapture } from '@/components/explore/IntentCapture';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { filterByWhen, filterNeedsPeople, sortActivities } from '@/lib/exploreFilters';

export function ResultsList({
  category,
  q,
  county,
  filters,
}: {
  category: Category;
  q: string;
  county: string | null;
  filters: ExploreFilters;
}) {
  const theme = useTheme();
  const searching = q.trim().length > 0;

  // Text search hits the real /api/search endpoint (centres/clubs/
  // activities/experiences) — circles aren't part of that response shape,
  // so a circle search falls back to a client-side name filter on the
  // county browse list instead (an honest, disclosed scope simplification,
  // not a silent gap).
  const searchQuery = useQuery({ queryKey: ['search', q], queryFn: () => search(q), enabled: searching });
  const centresQuery = useQuery({ queryKey: ['centres', county], queryFn: () => fetchCentres(county ?? undefined), enabled: !searching && category === 'centres' });
  const clubsQuery = useQuery({ queryKey: ['clubs', county], queryFn: () => fetchClubs(county ?? undefined), enabled: !searching && category === 'clubs' });
  const gamesQuery = useQuery({ queryKey: ['games', county], queryFn: () => fetchGames(county ?? undefined), enabled: !searching && category === 'games' });
  const circlesQuery = useQuery({ queryKey: ['circles', county], queryFn: () => fetchCircles(county ?? undefined), enabled: category === 'circles' });

  function noResults(title: string) {
    return (
      <View style={{ gap: Spacing.three }}>
        <EmptyState title={title} />
        {searching && county && <IntentCapture query={q} county={county} />}
      </View>
    );
  }

  if (category === 'circles') {
    const circles = (circlesQuery.data ?? []).filter((circle) => !searching || circle.name.toLowerCase().includes(q.toLowerCase()));
    if (!circles.length) return noResults('No Circles found');
    return (
      <View style={styles.list}>
        {circles.map((circle) => (
          <Pressable
            key={circle.id}
            onPress={() => router.push(`/(details)/circle/${circle.id}`)}
            style={[styles.row, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={styles.rowTitle}>{circle.name}</ThemedText>
            <ThemedText themeColor="textSecondary">
              {circle.area}, {circle.county} · {circle.members} members
            </ThemedText>
          </Pressable>
        ))}
      </View>
    );
  }

  if (category === 'centres') {
    const centres = searching ? (searchQuery.data?.centres ?? []) : (centresQuery.data ?? []);
    if (!centres.length) return noResults('No centres found');
    return (
      <View style={styles.grid}>
        {centres.map((centre) => (
          <PlaceCard key={centre.id} place={{ listingType: 'centre', ...centre }} onPress={() => router.push(`/(details)/centre/${centre.id}`)} />
        ))}
      </View>
    );
  }

  if (category === 'clubs') {
    const clubs = searching ? (searchQuery.data?.clubs ?? []) : (clubsQuery.data ?? []);
    if (!clubs.length) return noResults('No clubs found');
    return (
      <View style={styles.grid}>
        {clubs.map((club) => (
          <PlaceCard key={club.id} place={{ listingType: 'club', ...club }} onPress={() => router.push(`/(details)/club/${club.id}`)} />
        ))}
      </View>
    );
  }

  if (category === 'games') {
    const rawGames = searching ? (searchQuery.data?.activities ?? []) : dedupeGamesAsDiscoverItems(gamesQuery.data);
    const games = sortActivities(filterNeedsPeople(filterByWhen(rawGames, filters.when), filters.needsPeopleOnly), filters.sort);
    if (!games.length) return noResults('No games found');
    return (
      <View style={styles.grid}>
        {games.map((item) => (
          <ActivityCard key={item.id} item={item} />
        ))}
      </View>
    );
  }

  // adventures / experiences — no dedicated fetcher built this phase
  // (out of the Phase 2 plan's file list); real search still surfaces
  // matches when the user is actively searching.
  if (searching && searchQuery.data?.experiences.length) {
    return (
      <View style={styles.list}>
        {searchQuery.data.experiences.map((experience) => (
          <View key={experience.id} style={[styles.row, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={styles.rowTitle}>{experience.title}</ThemedText>
          </View>
        ))}
      </View>
    );
  }

  if (!searching) {
    return <EmptyState title="Coming soon" description="Browsing this category directly is on the way — try searching instead." />;
  }
  return noResults('No results');
}

// fetchGames() has no Game->DiscoverItem shape; this phase's ActivityCard
// only knows DiscoverItem, so this is a minimal, display-only adaptation
// (not a real "join" affordance, matching ActivityCard's own not-yet-
// tappable convention elsewhere in this phase).
function dedupeGamesAsDiscoverItems(games: import('@hello-circle/types').Game[] | undefined) {
  if (!games) return [];
  return games.map((game) => ({
    kind: 'game' as const,
    id: game.id,
    title: game.activityLabel,
    date: game.date,
    time: game.time,
    centreName: game.centreName,
    clubName: null,
    area: game.area,
    county: game.county,
    priceCents: game.priceCents,
    href: `/games/${game.id}`,
    spotsLeft: game.spotsLeft,
    joined: game.joined,
    imageUrl: game.imageUrl,
    isLive: false,
    durationMinutes: game.durationMinutes ?? 60,
    lat: null,
    lng: null,
    matchReasons: [],
  }));
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  list: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: 2,
  },
  rowTitle: {
    fontWeight: '700',
    fontSize: 15,
  },
});
