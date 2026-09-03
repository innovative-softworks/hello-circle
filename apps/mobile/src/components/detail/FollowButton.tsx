import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useFollow } from '@/hooks/useFollow';
import { useTheme } from '@/hooks/use-theme';

export function FollowButton({ centreId, initialFollowing, screenPath }: { centreId: string; initialFollowing: boolean; screenPath: string }) {
  const theme = useTheme();
  const { following, pending, toggle } = useFollow('centre', centreId, initialFollowing, screenPath);

  return (
    <Pressable
      onPress={toggle}
      disabled={pending}
      style={[styles.button, { borderColor: theme.primary, backgroundColor: following ? theme.primary : 'transparent' }]}>
      <ThemedText style={{ color: following ? '#fff' : theme.primary, fontWeight: '700' }}>{following ? 'Following' : 'Follow'}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
});
