import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchCircle, updateCircle } from '@/api/circles';
import { CircleEditForm, type CircleEditValues } from '@/components/circle/CircleEditForm';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function EditCircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const circleQuery = useQuery({ queryKey: ['circle', id], queryFn: () => fetchCircle(id) });
  const circle = circleQuery.data;

  async function handleSubmit(values: CircleEditValues) {
    if (!circle) return;
    setSubmitting(true);
    setError(null);
    try {
      // Preserve every field this MVP form doesn't expose — PUT /:id
      // overwrites the full row (joinMode is the one exception the server
      // COALESCEs), so omitting these would silently wipe them.
      await updateCircle(id, {
        name: values.name,
        activityLabel: circle.activityLabel,
        area: circle.area,
        county: circle.county,
        about: values.about,
        centreId: circle.centreId ?? undefined,
        imageUrl: circle.imageUrl ?? undefined,
        whatWeDo: values.whatWeDo,
        whoCanJoin: values.whoCanJoin,
        joinMode: values.joinMode,
      });
      queryClient.invalidateQueries({ queryKey: ['circle', id] });
      router.back();
    } catch {
      setError("Couldn't save changes — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!circle) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: `Edit ${circle.name}` }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <CircleEditForm circle={circle} onSubmit={handleSubmit} submitting={submitting} error={error} />
      </SafeAreaView>
    </ThemedView>
  );
}
