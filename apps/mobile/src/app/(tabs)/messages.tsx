import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchMyCircleInvitations, respondToCircleInvitation } from '@/api/circles';
import { fetchMyParticipation } from '@/api/participation';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { ParticipationRow } from '@/components/my-life/ParticipationRow';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Module scope, not component scope — Date.now() runs once when the module
// loads rather than during render, so it's outside the render-purity lint
// rule's concern entirely (being off by a JS-bundle-reload boundary is
// completely fine for a rough "recent games" display filter).
const YESTERDAY_ISO = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

// This backend has no DM/inbox concept — chat is always scoped to one
// Circle or one Game (see ChatPanel), never a standalone conversation. So
// this screen is an honest list of "your active chat scopes" plus anything
// needing a response (Circle invitations), not a fake unified inbox.
// Games/Circles rows reuse the same ParticipationRow/-Section components
// My Life uses, for one consistent row treatment app-wide.
export default function MessagesScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const signedIn = useAuthStore((state) => state.status === 'signedIn');

  const invitationsQuery = useQuery({ queryKey: ['circle-invitations'], queryFn: fetchMyCircleInvitations, enabled: signedIn });
  const participationQuery = useQuery({ queryKey: ['my-participation'], queryFn: fetchMyParticipation, enabled: signedIn });

  if (!signedIn) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText type="pageHeading">Messages</ThemedText>
          <ThemedText themeColor="textSecondary">Sign in to see your games and invitations.</ThemedText>
          <Button label="Sign in" onPress={() => router.push('/auth/sign-in')} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  async function handleRespond(id: string, accept: boolean) {
    await respondToCircleInvitation(id, accept);
    queryClient.invalidateQueries({ queryKey: ['circle-invitations'] });
    queryClient.invalidateQueries({ queryKey: ['my-circles'] });
  }

  const invitations = invitationsQuery.data ?? [];
  const games = (participationQuery.data ?? []).filter((entry) => entry.kind === 'game' && entry.date >= YESTERDAY_ISO);
  const circles = (participationQuery.data ?? []).filter((entry) => entry.kind === 'circle');

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ gap: Spacing.four, padding: Spacing.four }}>
          <ThemedText type="pageHeading">Messages</ThemedText>

          {invitations.length > 0 && (
            <Section title="Invitations">
              {invitations.map((invite) => (
                <ThemedView key={invite.id} style={[styles.row, { borderColor: theme.border }]}>
                  <ThemedText type="cardHeading">{invite.circleName}</ThemedText>
                  <ThemedText themeColor="textSecondary">
                    {invite.activityLabel} · invited by {invite.invitedByName}
                  </ThemedText>
                  <ThemedView style={styles.actions}>
                    <Button label="Accept" onPress={() => handleRespond(invite.id, true)} />
                    <Pressable onPress={() => handleRespond(invite.id, false)}>
                      <ThemedText themeColor="textSecondary">Decline</ThemedText>
                    </Pressable>
                  </ThemedView>
                </ThemedView>
              ))}
            </Section>
          )}

          <Section title="Your Circles">
            {circles.length === 0 ? (
              <ThemedText themeColor="textSecondary">No Circle chats yet.</ThemedText>
            ) : (
              circles.map((entry) => <ParticipationRow key={entry.ref} entry={entry} />)
            )}
          </Section>

          <Section title="Your Games">
            {games.length === 0 ? (
              <ThemedText themeColor="textSecondary">No upcoming or recent games.</ThemedText>
            ) : (
              games.map((entry) => <ParticipationRow key={entry.ref} entry={entry} />)
            )}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ThemedView style={{ gap: Spacing.two }}>
      <ThemedText type="sectionHeading">{title}</ThemedText>
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
});
