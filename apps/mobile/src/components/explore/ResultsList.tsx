import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { fetchCentres } from '@/api/centres';
import { fetchClubs } from '@/api/clubs';
import { fetchCircles } from '@/api/circles';
import { fetchExperiences } from '@/api/experiences';
import { fetchGames } from '@/api/games';
import { search } from '@/api/search';
import { Chip } from '@/components/Chip';
import { CompactActivityRow } from '@/components/explore/CompactActivityRow';
import type { Category } from '@/components/explore/CategoryTabs';
import type { ExploreFilters } from '@/components/explore/FilterSheet';
import { EmptyState } from '@/components/EmptyState';
import { IntentCapture } from '@/components/explore/IntentCapture';
import { SkeletonList } from '@/components/SkeletonLoader';
import { Spacing } from '@/constants/theme';
import { formatPrice, formatPriceCents } from '@/lib/format';
import { filterByPriceCap, filterByWhen, filterNeedsPeople, sortActivities } from '@/lib/exploreFilters';

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
  const searching = q.trim().length > 0;
  // Real sport/activity chip filter (Games & Sports module reference) —
  // derived from each game's own activityLabel, same "no fabricated
  // taxonomy" convention as the Circles category chips.
  const [sport, setSport] = useState<string | null>(null);

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
  const experiencesQuery = useQuery({
    queryKey: ['experiences', category, county],
    queryFn: () => fetchExperiences(category === 'adventures' ? 'adventure' : 'experience', county ?? undefined),
    enabled: !searching && (category === 'adventures' || category === 'experiences'),
  });

  const activeQuery = searching
    ? searchQuery
    : category === 'centres'
      ? centresQuery
      : category === 'clubs'
        ? clubsQuery
        : category === 'games'
          ? gamesQuery
          : category === 'circles'
            ? circlesQuery
            : category === 'adventures' || category === 'experiences'
              ? experiencesQuery
              : null;
  if (activeQuery?.isLoading) return <SkeletonList />;

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
          <CompactActivityRow
            key={circle.id}
            imageUrl={circle.imageUrl}
            category="Circle"
            title={circle.name}
            metadata={`${circle.area}, ${circle.county} · ${circle.members} members`}
            onPress={() => router.push(`/(details)/circle/${circle.id}`)}
          />
        ))}
      </View>
    );
  }

  if (category === 'centres') {
    const centres = searching ? (searchQuery.data?.centres ?? []) : (centresQuery.data ?? []);
    if (!centres.length) return noResults('No centres found');
    return (
      <View style={styles.list}>
        {centres.map((centre) => (
          <CompactActivityRow
            key={centre.id}
            imageUrl={centre.image}
            category="Place"
            title={centre.name}
            metadata={`${centre.area}, ${centre.county}`}
            price={`From ${formatPrice(centre.from)}/hr`}
            onPress={() => router.push(`/(details)/centre/${centre.id}`)}
          />
        ))}
      </View>
    );
  }

  if (category === 'clubs') {
    const clubs = searching ? (searchQuery.data?.clubs ?? []) : (clubsQuery.data ?? []);
    if (!clubs.length) return noResults('No clubs found');
    return (
      <View style={styles.list}>
        {clubs.map((club) => (
          <CompactActivityRow
            key={club.id}
            imageUrl={club.image}
            category="Club"
            title={club.name}
            metadata={`${club.area}, ${club.county}`}
            price={`${formatPrice(club.price)}/${club.unit}`}
            onPress={() => router.push(`/(details)/club/${club.id}`)}
          />
        ))}
      </View>
    );
  }

  if (category === 'games') {
    const allRawGames = searching ? (searchQuery.data?.activities ?? []) : dedupeGamesAsDiscoverItems(gamesQuery.data);
    const sports = Array.from(new Set(allRawGames.map((g) => g.title))).sort();
    const rawGames = sport ? allRawGames.filter((g) => g.title === sport) : allRawGames;
    const games = sortActivities(
      filterByPriceCap(filterNeedsPeople(filterByWhen(rawGames, filters.when), filters.needsPeopleOnly), filters.priceMaxCents),
      filters.sort
    );
    return (
      <View style={styles.list}>
        {sports.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingBottom: Spacing.three }}>
            <Chip label="All sports" selected={!sport} onPress={() => setSport(null)} />
            {sports.map((label) => (
              <Chip key={label} label={label} selected={sport === label} onPress={() => setSport(sport === label ? null : label)} />
            ))}
          </ScrollView>
        )}
        {!games.length
          ? noResults('No games found')
          : games.map((item) => (
              <CompactActivityRow
                key={item.id}
                imageUrl={item.imageUrl}
                category={item.isLive ? 'Live now' : 'Game'}
                title={item.title}
                metadata={[item.centreName ?? item.clubName, item.area].filter(Boolean).join(' · ')}
                price={`${formatPriceCents(item.priceCents)}${item.spotsLeft !== null ? ` · ${item.spotsLeft} spots left` : ''}`}
                onPress={item.kind === 'game' ? () => router.push(`/(details)/game/${item.id}`) : undefined}
              />
            ))}
      </View>
    );
  }

  if (category === 'adventures' || category === 'experiences') {
    const label = category === 'adventures' ? 'Adventure' : 'Experience';
    if (searching) {
      const results = searchQuery.data?.experiences.filter((e) => e.kind === (category === 'adventures' ? 'adventure' : 'experience')) ?? [];
      if (!results.length) return noResults(`No ${label.toLowerCase()}s found`);
      return (
        <View style={styles.list}>
          {results.map((experience) => (
            <CompactActivityRow
              key={experience.id}
              imageUrl={experience.imageUrl}
              category={label}
              title={experience.title}
              metadata={`${experience.area}, ${experience.county}`}
              price={formatPriceCents(experience.priceCents)}
              onPress={() => router.push(`/(details)/experience/${experience.id}`)}
            />
          ))}
        </View>
      );
    }
    const experiences = experiencesQuery.data ?? [];
    if (!experiences.length) return noResults(`No ${label.toLowerCase()}s found`);
    return (
      <View style={styles.list}>
        {experiences.map((experience) => (
          <CompactActivityRow
            key={experience.id}
            imageUrl={experience.imageUrl}
            category={label}
            title={experience.title}
            metadata={`${experience.area}, ${experience.county}`}
            price={`${formatPriceCents(experience.priceCents)} / person`}
            onPress={() => router.push(`/(details)/experience/${experience.id}`)}
          />
        ))}
      </View>
    );
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
  list: {
    paddingHorizontal: 0,
  },
});
