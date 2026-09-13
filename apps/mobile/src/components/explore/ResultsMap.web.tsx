import type { Category } from '@/components/explore/CategoryTabs';
import { EmptyState } from '@/components/EmptyState';

// Platform-specific stand-in for ResultsMap.tsx — see DetailMap.web.tsx for
// why react-native-maps can't be imported on web at all (not just "used
// carefully"). `category`/`county` are accepted only to match the native
// component's signature; this stand-in never needs them.
export function ResultsMap(_props: { category: Category; county: string | null }) {
  return <EmptyState icon="map-outline" title="Map view isn't available on web" description="Switch to the list view, or see this in the mobile app." />;
}
