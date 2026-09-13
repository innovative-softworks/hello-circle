import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchGame, fetchGameJoinStatus, fetchGameParticipants, fetchGames, joinGame, joinGameWaitlist, leaveGame, leaveGameWaitlist } from '@/api/games';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/auth/store';
import { setPendingAction } from '@/auth/pendingAction';
import { AddToCalendarSheet } from '@/components/detail/AddToCalendarSheet';
import { AvatarGroup } from '@/components/AvatarGroup';
import { Card } from '@/components/Card';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { FavouriteHeart } from '@/components/detail/FavouriteHeart';
import { HeroIconButton, ImmersiveHero } from '@/components/detail/ImmersiveHero';
import { StickyPriceRail } from '@/components/detail/StickyPriceRail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { openCheckoutAndAwaitReturn, pollUntilPaid } from '@/lib/checkout';
import { formatPriceCents } from '@/lib/format';

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { status: authStatus, residentId } = useAuthStore();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const calendarSheetRef = useRef<BottomSheetModal>(null);

  const gameQuery = useQuery({ queryKey: ['game', id], queryFn: () => fetchGame(id) });
  const game = gameQuery.data;

  const participantsQuery = useQuery({ queryKey: ['game-participants', id], queryFn: () => fetchGameParticipants(id) });

  // "Similar" = other open games sharing this one's activity, same county —
  // a real, already-fetched dataset (no fabricated recommendations).
  const similarQuery = useQuery({
    queryKey: ['games', game?.county],
    queryFn: () => fetchGames(game?.county ?? undefined),
    enabled: !!game,
  });
  const similar = (similarQuery.data ?? []).filter((g) => g.id !== id && g.activityLabel === game?.activityLabel).slice(0, 5);

  async function refetch() {
    await queryClient.invalidateQueries({ queryKey: ['game', id] });
    await queryClient.invalidateQueries({ queryKey: ['game-participants', id] });
  }

  // Joining (and joining the waitlist) requires a signed-in resident
  // server-side (requireResident on POST /:id/join and /:id/waitlist) —
  // this screen used to call straight through to those endpoints with no
  // signed-out guard at all, so a guest tapping "Join" got a silently
  // swallowed 401 and nothing visibly happened. Redirects to sign-in first,
  // preserving this screen so they land back here afterwards.
  async function requireSignIn(): Promise<boolean> {
    if (authStatus === 'signedIn') return true;
    await setPendingAction({ kind: 'returnTo', screenPath: `/(details)/game/${id}` });
    router.push('/auth/sign-in');
    return false;
  }

  async function handleJoin() {
    if (!(await requireSignIn())) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await joinGame(id);
      if (res.url) {
        const outcome = await openCheckoutAndAwaitReturn(res.url);
        if (outcome.status !== 'success') {
          setMessage('Checkout was not completed.');
          return;
        }
        const statusRow = await pollUntilPaid(fetchGameJoinStatus, res.ref!);
        if (statusRow.paymentStatus !== 'paid') {
          setMessage("Still confirming your payment — check My Life shortly if this doesn't update.");
          await refetch();
          return;
        }
      }
      // Same confirmation screen for both paths — a paid join used to fall
      // straight through to the (now-joined) game detail screen with no
      // "You're in!" moment at all, unlike every other paid flow in this
      // app (booking/registration/make-it-happen all route to a
      // confirmation screen after checkout, not just the free path).
      await refetch();
      router.push({ pathname: '/(details)/game/[id]/confirmation', params: { id } });
      return;
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't join this game — please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleLeave() {
    setPending(true);
    setMessage(null);
    try {
      await leaveGame(id);
      await refetch();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't leave this game — please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleJoinWaitlist() {
    if (!(await requireSignIn())) return;
    setPending(true);
    setMessage(null);
    try {
      await joinGameWaitlist(id);
      await refetch();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't join the waitlist — please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleLeaveWaitlist() {
    setPending(true);
    setMessage(null);
    try {
      await leaveGameWaitlist(id);
      await refetch();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't leave the waitlist — please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleShare() {
    if (!game) return;
    await Share.share({
      message: `${game.activityLabel} on ${game.date} at ${game.time} · ${game.centreName ?? game.locationText}, via HelloCircle.`,
    });
  }

  function handleDirections() {
    if (!game) return;
    const query = encodeURIComponent([game.centreName ?? game.locationText, game.area, game.county].filter(Boolean).join(', '));
    Linking.openURL(`https://maps.google.com/?q=${query}`);
  }

  if (!game) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isFull = game.spotsLeft <= 0;
  const isHost = authStatus === 'signedIn' && residentId === game.hostResidentId;
  const goingCount = participantsQuery.data?.total ?? game.joined;

  // Leaving a paid game just deletes the participation row server-side —
  // no refund is tracked or issued (server/src/routes/games.ts's DELETE
  // /:id/join). That's a real, silent financial consequence a bare "Leave"
  // button gave no warning about — this confirms first, same guard as
  // booking cancellation already has.
  function confirmLeavePaidGame() {
    Alert.alert('Leave this game?', "This game isn't free — leaving won't automatically refund what you paid. Contact the host if you need a refund.", [
      { text: 'Stay in', style: 'cancel' },
      { text: 'Leave anyway', style: 'destructive', onPress: handleLeave },
    ]);
  }

  const cta = game.joinedByMe
    ? { label: 'Leave', onPress: (game.priceCents ?? 0) > 0 ? confirmLeavePaidGame : handleLeave }
    : game.waitlistedByMe
      ? { label: 'Leave waitlist', onPress: handleLeaveWaitlist }
      : isFull
        ? { label: 'Join waitlist', onPress: handleJoinWaitlist }
        : { label: 'Join', onPress: handleJoin };

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ paddingBottom: Spacing.four }}>
          <ImmersiveHero
            imageUrl={game.imageUrl}
            placeholderIcon="calendar-outline"
            onBack={() => router.back()}
            actions={
              <>
                <View style={{ borderRadius: Radius.pill, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' }}>
                  <FavouriteHeart listingType="game" listingId={game.id} initialSaved={false} screenPath={`/(details)/game/${game.id}`} />
                </View>
                <HeroIconButton onPress={handleShare} icon="share-outline" label="Share" />
              </>
            }
          />

          <View style={{ padding: Spacing.four, gap: Spacing.three }}>
            <View style={{ gap: 4 }}>
              <ThemedText type="eyebrow">{game.skillLevel}</ThemedText>
              <ThemedText type="editorial">{game.activityLabel}</ThemedText>
            </View>

            <ThemedText themeColor="textSecondary">
              {game.date} at {game.time} · {game.centreName ?? game.locationText}
              {game.area ? ` · ${game.area}` : ''}
            </ThemedText>

            <Pressable
              onPress={() => router.push({ pathname: '/(details)/game/[id]/going', params: { id: game.id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <AvatarGroup people={(participantsQuery.data?.participants ?? []).map((p) => ({ name: p.name }))} total={goingCount} />
              <ThemedText themeColor="textSecondary" style={{ flex: 1 }}>
                {goingCount} going{game.spotsLeft > 0 ? ` · ${game.spotsLeft} spots left` : ''}
              </ThemedText>
              {goingCount > 0 && (
                <ThemedText type="smallBold" themeColor="primary">
                  See all
                </ThemedText>
              )}
            </Pressable>

            {game.status === 'pending_participants' && game.minParticipants !== null && (
              <ThemedText themeColor="primary">Needs {game.minParticipants} players to confirm — still joinable.</ThemedText>
            )}

            {game.description && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">About this game</ThemedText>
                <ThemedText>{game.description}</ThemedText>
              </View>
            )}

            {game.equipmentNeeded && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">What you&apos;ll need</ThemedText>
                <ThemedText>{game.equipmentNeeded}</ThemedText>
              </View>
            )}

            <View style={{ gap: 4 }}>
              <ThemedText type="sectionHeading">Meeting point</ThemedText>
              <ThemedText>{game.centreName ?? game.locationText}</ThemedText>
              {game.area && (
                <ThemedText themeColor="textSecondary">
                  {game.area}
                  {game.county ? `, ${game.county}` : ''}
                </ThemedText>
              )}
              <Pressable onPress={handleDirections}>
                <ThemedText type="smallBold" themeColor="primary">
                  Get directions →
                </ThemedText>
              </Pressable>
            </View>

            {game.cancellationPolicy && (
              <View style={{ gap: 4 }}>
                <ThemedText type="sectionHeading">Cancellation policy</ThemedText>
                <ThemedText themeColor="textSecondary">{game.cancellationPolicy}</ThemedText>
              </View>
            )}

            <View style={{ gap: 4 }}>
              <ThemedText type="sectionHeading">Host</ThemedText>
              {game.hostVerified ? (
                <Pressable onPress={() => router.push(`/(details)/hosts/${game.hostResidentId}`)}>
                  <ThemedText themeColor="primary">{game.hostName} · Verified</ThemedText>
                </Pressable>
              ) : (
                <ThemedText themeColor="textSecondary">{game.hostName}</ThemedText>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: Spacing.three }}>
              <Pressable onPress={() => calendarSheetRef.current?.present()}>
                <ThemedText type="smallBold" themeColor="primary">
                  Add to calendar
                </ThemedText>
              </Pressable>
            </View>
            {calendarStatus && <ThemedText themeColor="textSecondary">{calendarStatus}</ThemedText>}

            {message && <ThemedText themeColor="textSecondary">{message}</ThemedText>}

            {(game.joinedByMe || isHost) && <ChatPanel scopeType="game" scopeId={game.id} />}

            {similar.length > 0 && (
              <View style={{ gap: Spacing.two }}>
                <ThemedText type="sectionHeading">Similar games</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
                  {similar.map((g) => (
                    <Card key={g.id} width={180} imageHeight={90} imageUrl={g.imageUrl} placeholderIcon="calendar-outline" onPress={() => router.push(`/(details)/game/${g.id}`)}>
                      <ThemedText numberOfLines={1} style={{ fontWeight: '700', fontSize: 14 }}>
                        {g.activityLabel}
                      </ThemedText>
                      <ThemedText themeColor="textSecondary" style={{ fontSize: 12 }}>
                        {g.date} · {g.time}
                      </ThemedText>
                      <ThemedText themeColor="primary" style={{ fontSize: 12 }}>
                        {formatPriceCents(g.priceCents)}
                      </ThemedText>
                    </Card>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        </ScrollView>

        <StickyPriceRail priceLabel={formatPriceCents(game.priceCents)} ctaLabel={cta.label} onPress={cta.onPress} loading={pending} />

        <AddToCalendarSheet
          ref={calendarSheetRef}
          event={{
            title: game.activityLabel,
            date: game.date,
            time: game.time,
            durationMinutes: game.durationMinutes ?? 60,
            notes: game.centreName ?? game.locationText,
          }}
          eventLink={`https://hellocircle.ie/games/${game.id}`}
          onStatus={setCalendarStatus}
        />
      </SafeAreaView>
    </ThemedView>
  );
}
