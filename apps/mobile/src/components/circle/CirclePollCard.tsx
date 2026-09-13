import type { CirclePoll } from '@hello-circle/types';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Ports client/src/pages/CircleDetail.tsx's PollCard — same "recommended
// option" derivation (max votes, once closed) computed here rather than
// server-stored, matching the existing web behaviour exactly.
export function CirclePollCard({
  poll,
  isOrganiser,
  onVote,
  onClose,
}: {
  poll: CirclePoll;
  isOrganiser: boolean;
  onVote: (optionId: number) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const maxVotes = Math.max(0, ...poll.options.map((o) => o.voteCount));

  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
      <View style={styles.headerRow}>
        <ThemedText type="cardHeading" style={{ flex: 1 }}>
          {poll.question}
        </ThemedText>
        <View style={[styles.badge, { backgroundColor: poll.status === 'open' ? theme.primary : theme.backgroundSelected }]}>
          <ThemedText style={{ color: poll.status === 'open' ? '#fff' : theme.textSecondary, fontSize: 11, fontWeight: '700' }}>
            {poll.status === 'open' ? 'Open' : 'Closed'}
          </ThemedText>
        </View>
      </View>

      <View style={{ gap: Spacing.one, marginTop: Spacing.two }}>
        {poll.options.map((option) => {
          const isRecommended = poll.status === 'closed' && option.voteCount === maxVotes && maxVotes > 0;
          return (
            <Pressable
              key={option.id}
              disabled={poll.status !== 'open'}
              onPress={() => onVote(option.id)}
              style={[
                styles.option,
                {
                  borderColor: option.votedByMe ? theme.primary : theme.border,
                  backgroundColor: option.votedByMe ? theme.backgroundSelected : theme.background,
                },
              ]}>
              <ThemedText style={{ fontSize: 14 }}>
                {option.date}
                {option.time ? ` · ${option.time}` : ''}
                {isRecommended && (
                  <ThemedText themeColor="primary" style={{ fontWeight: '700' }}>
                    {' '}
                    · Recommended
                  </ThemedText>
                )}
              </ThemedText>
              <ThemedText type="metadata">
                {option.voteCount} vote{option.voteCount === 1 ? '' : 's'}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {isOrganiser && poll.status === 'open' && (
        <Pressable onPress={onClose} style={{ marginTop: Spacing.two }}>
          <ThemedText themeColor="textSecondary">Close poll</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  badge: {
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
});
