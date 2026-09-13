import type { Centre, Club } from '@hello-circle/types';

import { Card } from '@/components/Card';
import { ThemedText } from '@/components/themed-text';
import { formatPrice } from '@/lib/format';

type Place = ({ listingType: 'centre' } & Centre) | ({ listingType: 'club' } & Club);

export function PlaceCard({ place, onPress }: { place: Place; onPress: () => void }) {
  const price = place.listingType === 'centre' ? `From ${formatPrice(place.from)}/hr` : `${formatPrice(place.price)}/${place.unit}`;

  return (
    <Card width={180} imageHeight={100} imageUrl={place.image} placeholderIcon="business-outline" onPress={onPress}>
      <ThemedText numberOfLines={1} style={{ fontWeight: '700', fontSize: 14 }}>
        {place.name}
      </ThemedText>
      <ThemedText themeColor="textSecondary" numberOfLines={1} style={{ fontSize: 12 }}>
        {place.area}, {place.county}
      </ThemedText>
      <ThemedText themeColor="primary" style={{ fontSize: 12 }}>
        {price}
      </ThemedText>
    </Card>
  );
}
