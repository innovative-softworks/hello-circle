import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  closeCirclePoll,
  createCirclePoll,
  fetchCircle,
  fetchCircleMembers,
  fetchCircleMembership,
  fetchCirclePolls,
  fetchCircleUpcoming,
  joinCircle,
  leaveCircle,
  setCircleStatus,
  voteOnCirclePollOption,
} from '@/api/circles';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/auth/store';
import { setPendingAction } from '@/auth/pendingAction';
import { AvatarGroup } from '@/components/AvatarGroup';
import { Button } from '@/components/Button';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { CirclePollCard } from '@/components/circle/CirclePollCard';
import { CreatePollForm } from '@/components/circle/CreatePollForm';
import { HeroIconButton, ImmersiveHero } from '@/components/detail/ImmersiveHero';
import { InviteResident } from '@/components/circle/InviteResident';
import { JoinRequestsList } from '@/components/circle/JoinRequestsList';
import { MemberList } from '@/components/circle/MemberList';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { hapticSuccess } from '@/lib/haptics';

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const [pending, setPending] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [justJoined, setJustJoined] = useState(false);
  const [pollFormOpen, setPollFormOpen] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const circleQuery = useQuery({ queryKey: ['circle', id], queryFn: () => fetchCircle(id) });
  const upcomingQuery = useQuery({ queryKey: ['circle-upcoming', id], queryFn: () => fetchCircleUpcoming(id) });
  const membershipQuery = useQuery({ queryKey: ['circle-membership', id], queryFn: () => fetchCircleMembership(id), enabled: signedIn });
  const pollsQuery = useQuery({ queryKey: ['circle-polls', id], queryFn: () => fetchCirclePolls(id) });
  // Public member preview (no `full` flag) — safe to show to any visitor,
  // unlike MemberList's organiser-only full view further down this screen.
  const membersQuery = useQuery({ queryKey: ['circle-members', id], queryFn: () => fetchCircleMembers(id) });

  const circle = circleQuery.data;
  if (!circle) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const membership = membershipQuery.data;
  const isMember = membership?.member ?? false;
  const isRequested = membership?.requested ?? false;

  // Non-null assertion (not `circle` directly) since narrowing from the
  // `if (!circle) return` guard above doesn't cross into this closure —
  // same convention as handleToggleStatus below.
  function handleShare() {
    const slugOrId = circle!.slug ?? circle!.id;
    router.push({
      pathname: '/(modals)/share',
      params: {
        title: 'Share this Circle',
        text: `Join ${circle!.name} on HelloCircle: https://hellocircle.ie/circles/${slugOrId}`,
        link: `https://hellocircle.ie/circles/${slugOrId}`,
        qr: 'true',
      },
    });
  }

  async function handleJoinLeave() {
    if (!signedIn) {
      // Preserves this screen across the magic-link round trip (same
      // 'returnTo' primitive game/[id].tsx uses) — previously this just
      // pushed to sign-in with no memory of which Circle they meant to
      // join, dropping them on My Life afterwards instead.
      await setPendingAction({ kind: 'returnTo', screenPath: `/(details)/circle/${id}` });
      router.push('/auth/sign-in');
      return;
    }
    setPending(true);
    setJoinError(null);
    try {
      if (isMember) {
        await leaveCircle(id);
      } else {
        const result = await joinCircle(id);
        // Micro-interaction (spec §31): instant join briefly confirms with
        // "Joined ✓" before the refetch below settles the button into its
        // real "Leave Circle" state — skipped for an approval request,
        // which has no equivalent celebratory moment.
        if (!result.requested) {
          hapticSuccess();
          setJustJoined(true);
          setTimeout(() => setJustJoined(false), 1200);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['circle-membership', id] });
      queryClient.invalidateQueries({ queryKey: ['my-circles'] });
    } catch (err) {
      setJoinError(err instanceof ApiError ? err.message : "Couldn't update your membership — please try again.");
    } finally {
      setPending(false);
    }
  }

  const joinLabel = justJoined
    ? 'Joined ✓'
    : isMember
      ? 'Leave Circle'
      : isRequested
        ? 'Request sent'
        : circle.joinMode === 'approval'
          ? 'Request to join'
          : 'Join Circle';

  async function handleCreatePoll(question: string, dateInputs: string[]) {
    await createCirclePoll(circle!.id, { question, options: dateInputs.map((date) => ({ date })) });
    setPollFormOpen(false);
    queryClient.invalidateQueries({ queryKey: ['circle-polls', id] });
  }

  async function handleVote(pollId: string, optionId: number) {
    await voteOnCirclePollOption(circle!.id, pollId, optionId);
    queryClient.invalidateQueries({ queryKey: ['circle-polls', id] });
  }

  async function handleClosePoll(pollId: string) {
    await closeCirclePoll(circle!.id, pollId);
    queryClient.invalidateQueries({ queryKey: ['circle-polls', id] });
  }

  function handleToggleStatus() {
    // Narrowing above (`if (!circle) return`) doesn't cross this function
    // boundary — circle is always defined by the time this handler can run,
    // since the button rendering it only exists once circle has loaded.
    const closing = circle!.status === 'active';
    const circleId = circle!.id;
    const doToggle = async () => {
      setStatusPending(true);
      try {
        await setCircleStatus(circleId, closing ? 'closed' : 'active');
        queryClient.invalidateQueries({ queryKey: ['circle', id] });
      } finally {
        setStatusPending(false);
      }
    };
    if (closing) {
      Alert.alert('Close this Circle?', 'It will drop out of public browse. Members will be notified.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close Circle', style: 'destructive', onPress: doToggle },
      ]);
    } else {
      doToggle();
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView>
        <ImmersiveHero
          imageUrl={circle.imageUrl}
          placeholderIcon="people-outline"
          onBack={() => router.back()}
          actions={<HeroIconButton onPress={handleShare} icon="share-outline" label="Share" />}
        />
        <View style={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="editorial">{circle.name}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {circle.activityLabel} · {circle.area}, {circle.county} · {circle.members} members
          </ThemedText>

          <View style={styles.statsRow}>
            <Stat label="Plans this month" value={String(circle.plansThisMonth)} />
            {circle.showUpRate != null && <Stat label="Show-up rate" value={`${circle.showUpRate}%`} />}
          </View>

          <ThemedText>{circle.about}</ThemedText>

          {circle.hostVerified ? (
            <Pressable onPress={() => router.push(`/(details)/hosts/${circle.createdByResidentId}`)}>
              <ThemedText themeColor="primary" type="metadata">
                Started by {circle.hostName} · Verified
              </ThemedText>
            </Pressable>
          ) : (
            <ThemedText themeColor="textSecondary" type="metadata">
              Started by {circle.hostName}
            </ThemedText>
          )}

          {circle.whatWeDo && (
            <View>
              <ThemedText type="sectionHeading">What we do</ThemedText>
              <ThemedText themeColor="textSecondary">{circle.whatWeDo}</ThemedText>
            </View>
          )}
          {circle.whoCanJoin && (
            <View>
              <ThemedText type="sectionHeading">Who can join</ThemedText>
              <ThemedText themeColor="textSecondary">{circle.whoCanJoin}</ThemedText>
            </View>
          )}

          {circle.nextPlan && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="sectionHeading">Next plan</ThemedText>
              <ThemedText themeColor="textSecondary">
                {circle.nextPlan.date} at {circle.nextPlan.time} · {circle.nextPlan.spotsLeft} spots left
              </ThemedText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                <AvatarGroup people={(membersQuery.data?.members ?? []).map((m) => ({ name: m.name }))} total={circle.nextPlan.joined} />
                <ThemedText themeColor="textSecondary">{circle.nextPlan.joined} going</ThemedText>
              </View>
            </View>
          )}

          {circle.members > 0 && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="sectionHeading">Members</ThemedText>
              <AvatarGroup people={(membersQuery.data?.members ?? []).map((m) => ({ name: m.name }))} total={circle.members} size={36} max={6} />
            </View>
          )}

          {(upcomingQuery.data?.length ?? 0) > 0 && (
            <View>
              <ThemedText type="sectionHeading">Upcoming</ThemedText>
              {upcomingQuery.data!.map((plan) => (
                <ThemedText key={plan.id} themeColor="textSecondary">
                  {plan.date} · {plan.time}
                </ThemedText>
              ))}
            </View>
          )}

          {signedIn && isMember && (
            <View style={{ gap: Spacing.two }}>
              <View style={styles.headerRow}>
                <ThemedText type="sectionHeading">Planning</ThemedText>
                {membership?.role === 'organiser' && !pollFormOpen && (
                  <Pressable onPress={() => setPollFormOpen(true)}>
                    <ThemedText themeColor="primary">+ Propose a time</ThemedText>
                  </Pressable>
                )}
              </View>
              {pollFormOpen && <CreatePollForm onSubmit={handleCreatePoll} onCancel={() => setPollFormOpen(false)} />}
              {(pollsQuery.data ?? []).length === 0 && !pollFormOpen && (
                <ThemedText themeColor="textSecondary">No plans proposed yet.</ThemedText>
              )}
              {(pollsQuery.data ?? []).map((poll) => (
                <CirclePollCard
                  key={poll.id}
                  poll={poll}
                  isOrganiser={membership?.role === 'organiser'}
                  onVote={(optionId) => handleVote(poll.id, optionId)}
                  onClose={() => handleClosePoll(poll.id)}
                />
              ))}
            </View>
          )}

          <Button label={joinLabel} onPress={handleJoinLeave} loading={pending} disabled={isRequested} />
          {joinError && <ThemedText themeColor="danger">{joinError}</ThemedText>}

          {membership?.role === 'organiser' && (
            <View style={{ gap: Spacing.three }}>
              <ThemedText type="sectionHeading">Organiser tools</ThemedText>
              <View style={styles.actionsRow}>
                <Button label="Edit Circle" onPress={() => router.push({ pathname: '/(details)/circle/[id]/edit', params: { id: circle.id } })} />
                <Button
                  label={circle.status === 'active' ? 'Close Circle' : 'Reopen Circle'}
                  onPress={handleToggleStatus}
                  loading={statusPending}
                />
              </View>
              {circle.joinMode === 'approval' && <JoinRequestsList circleId={circle.id} />}
              <MemberList circleId={circle.id} />
              <InviteResident circleId={circle.id} />
            </View>
          )}
          {isMember && <ChatPanel scopeType="circle" scopeId={circle.id} />}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <ThemedText type="cardHeading">{value}</ThemedText>
      <ThemedText type="metadata">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.five,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
