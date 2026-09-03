import { Image } from 'expo-image';
import { Dimensions, ScrollView, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

const screenWidth = Dimensions.get('window').width;

export function Gallery({ images }: { images: string[] }) {
  const theme = useTheme();
  if (!images.length) {
    return <View style={[styles.image, { backgroundColor: theme.primary, opacity: 0.15 }]} />;
  }
  return (
    <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
      {images.map((uri) => (
        <Image key={uri} source={{ uri }} style={styles.image} contentFit="cover" />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  image: {
    width: screenWidth,
    height: 240,
  },
});
