import { Pressable, StyleSheet, Text } from 'react-native';

import { useFavourite } from '@/hooks/useFavourite';
import { useTheme } from '@/hooks/use-theme';

export function FavouriteHeart({
  listingType,
  listingId,
  initialSaved,
  screenPath,
}: {
  listingType: 'centre' | 'club';
  listingId: string;
  initialSaved: boolean;
  screenPath: string;
}) {
  const theme = useTheme();
  const { saved, pending, toggle } = useFavourite(listingType, listingId, initialSaved, screenPath);

  return (
    <Pressable onPress={toggle} disabled={pending} style={styles.button}>
      <Text style={{ fontSize: 20, color: saved ? theme.danger : theme.textSecondary }}>{saved ? '♥' : '♡'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 8,
  },
});
