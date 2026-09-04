import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchCircle, fetchCircleMembership, fetchCircleUpcoming, joinCircle, leaveCircle, setCircleStatus } from '@/api/circles';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { Image } from 'expo-image';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { InviteResident } from '@/components/circle/InviteResident';
import { JoinRequestsList } from '@/components/circle/JoinRequestsList';
import { MemberList } from '@/components/circle/MemberList';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const [pending, setPending] = useState(false);
  const [statusPending, setStatusPending] = useState(false);

  const circleQuery = useQuery({ queryKey: ['circle', id], queryFn: () => fetchCircle(id) });
  const upcomingQuery = useQuery({ queryKey: ['circle-upcoming', id], queryFn: () => fetchCircleUpcoming(id) });
  const membershipQuery = useQuery({ queryKey: ['circle-membership', id], queryFn: () => fetchCircleMembership(id), enabled: signedIn });

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

  async function handleJoinLeave() {
    if (!signedIn) {
      router.push('/auth/sign-in');
      return;
    }
    setPending(true);
    try {
      if (isMember) {
        await leaveCircle(id);
      } else {
        await joinCircle(id);
      }
      queryClient.invalidateQueries({ queryKey: ['circle-membership', id] });
      queryClient.invalidateQueries({ queryKey: ['my-circles'] });
    } finally {
      setPending(false);
    }
  }

  const joinLabel = isMember ? 'Leave Circle' : isRequested ? 'Request sent' : circle.joinMode === 'approval' ? 'Request to join' : 'Join Circle';

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
      <Stack.Screen options={{ title: circle.name }} />
      <ScrollView>
        {circle.imageUrl ? (
          <Image source={{ uri: circle.imageUrl }} style={styles.hero} contentFit="cover" />
        ) : (
          <View style={[styles.hero, { backgroundColor: theme.primary, opacity: 0.15 }]} />
        )}
        <View style={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="title">{circle.name}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {circle.activityLabel} · {circle.area}, {circle.county} · {circle.members} members
          </ThemedText>

          <View style={styles.statsRow}>
            <Stat label="Plans this month" value={String(circle.plansThisMonth)} />
            {circle.showUpRate != null && <Stat label="Show-up rate" value={`${circle.showUpRate}%`} />}
          </View>

          <ThemedText>{circle.about}</ThemedText>

          {circle.whatWeDo && (
            <View>
              <ThemedText type="subtitle">What we do</ThemedText>
              <ThemedText themeColor="textSecondary">{circle.whatWeDo}</ThemedText>
            </View>
          )}
          {circle.whoCanJoin && (
            <View>
              <ThemedText type="subtitle">Who can join</ThemedText>
              <ThemedText themeColor="textSecondary">{circle.whoCanJoin}</ThemedText>
            </View>
          )}

          {circle.nextPlan && (
            <View>
              <ThemedText type="subtitle">Next plan</ThemedText>
              <ThemedText themeColor="textSecondary">
                {circle.nextPlan.date} at {circle.nextPlan.time} · {circle.nextPlan.spotsLeft} spots left
              </ThemedText>
            </View>
          )}

          {(upcomingQuery.data?.length ?? 0) > 0 && (
            <View>
              <ThemedText type="subtitle">Upcoming</ThemedText>
              {upcomingQuery.data!.map((plan) => (
                <ThemedText key={plan.id} themeColor="textSecondary">
                  {plan.date} · {plan.time}
                </ThemedText>
              ))}
            </View>
          )}

          <Button label={joinLabel} onPress={handleJoinLeave} loading={pending} disabled={isRequested} />

          {membership?.role === 'organiser' && (
            <View style={{ gap: Spacing.three }}>
              <ThemedText type="subtitle">Organiser tools</ThemedText>
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
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.statLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    height: 200,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.five,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  statValue: {
    fontWeight: '800',
    fontSize: 20,
  },
  statLabel: {
    fontSize: 12,
  },
});
