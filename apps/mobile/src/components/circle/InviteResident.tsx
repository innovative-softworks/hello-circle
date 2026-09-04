import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { inviteToCircle } from '@/api/circles';
import { searchResidents } from '@/api/residents';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Mobile equivalent of client/src/components/ResidentPicker.tsx — a
// name-search autocomplete, not a port. No raw-Resident-ID manual fallback
// this phase (web has one as a secondary affordance for sparse
// "findable by name" adoption) — a disclosed deferral, not a silent drop.
export function InviteResident({ circleId }: { circleId: string }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const query_ = query.trim();

  useEffect(() => {
    if (query_.length < 2) return;
    const timeout = setTimeout(() => {
      searchResidents(query_)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query_]);

  async function handleInvite(residentId: string) {
    await inviteToCircle(circleId, residentId);
    setInvitedIds((prev) => new Set(prev).add(residentId));
  }

  const visibleResults = query_.length < 2 ? [] : results;

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="subtitle">Invite someone</ThemedText>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name…"
        placeholderTextColor={theme.textSecondary}
        style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: Spacing.two, color: theme.text }}
      />
      {visibleResults.map((resident) => (
        <Pressable
          key={resident.id}
          onPress={() => handleInvite(resident.id)}
          disabled={invitedIds.has(resident.id)}
          style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.two }}>
          <ThemedText>{resident.name}</ThemedText>
          <ThemedText themeColor={invitedIds.has(resident.id) ? 'primary' : 'textSecondary'}>
            {invitedIds.has(resident.id) ? 'Invited' : 'Invite'}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
