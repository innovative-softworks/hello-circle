import { StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export function SearchBar({ value, onChangeText }: { value: string; onChangeText: (text: string) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="What do you want to do?"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  input: {
    height: 44,
    fontSize: 16,
  },
});
