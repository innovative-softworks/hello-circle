import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { askHelloCircle, type AskHelloCircleResponse } from '@/api/ask';
import { ApiError } from '@/api/client';
import { CompactActivityRow } from '@/components/explore/CompactActivityRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPrice, formatPriceCents } from '@/lib/format';

// Rule-based conversational front door onto the same structured search
// Explore's search box runs (server's runStructuredSearch, shared with
// /api/search) — deliberately not an LLM (no AI key/SDK configured
// anywhere in this app). Every result row is a real DB row; the reply
// text is templated around real counts, never generated.
const SUGGESTIONS = ['Free activities this weekend in Dublin', 'Badminton this evening', 'Something for kids under €10', 'Swimming near me tomorrow'];

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  result?: AskHelloCircleResponse;
}

export default function AskHelloCircleScreen() {
  const theme = useTheme();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || asking) return;
    setInput('');
    setTurns((prev) => [...prev, { role: 'user', text: trimmed }]);
    setAsking(true);
    try {
      const result = await askHelloCircle(trimmed);
      setTurns((prev) => [...prev, { role: 'assistant', text: result.reply, result }]);
    } catch (err) {
      const message2 = err instanceof ApiError ? err.message : "Couldn't reach HelloCircle — please try again.";
      setTurns((prev) => [...prev, { role: 'assistant', text: message2 }]);
    } finally {
      setAsking(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScreenHeader title="Ask HelloCircle" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
          <ScrollView ref={scrollRef} contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three, flexGrow: 1 }}>
            {turns.length === 0 && (
              <View style={{ gap: Spacing.three }}>
                <ThemedText themeColor="textSecondary">Ask in plain English — I&apos;ll search real listings, not make anything up.</ThemedText>
                <View style={{ gap: Spacing.two }}>
                  {SUGGESTIONS.map((s) => (
                    <Pressable key={s} onPress={() => send(s)} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card, padding: Spacing.three }}>
                      <ThemedText>{s}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {turns.map((turn, i) => (
              <View key={i} style={{ alignItems: turn.role === 'user' ? 'flex-end' : 'flex-start', gap: Spacing.two }}>
                <View
                  style={{
                    maxWidth: '85%',
                    backgroundColor: turn.role === 'user' ? theme.primary : theme.backgroundElement,
                    borderRadius: Radius.card,
                    padding: Spacing.three,
                  }}>
                  <ThemedText style={{ color: turn.role === 'user' ? '#fff' : undefined }}>{turn.text}</ThemedText>
                </View>

                {turn.result && (
                  <View style={{ width: '100%', gap: 2 }}>
                    {turn.result.activities.slice(0, 5).map((item) => (
                      <CompactActivityRow
                        key={`a-${item.id}`}
                        imageUrl={item.imageUrl}
                        category={item.isLive ? 'Live now' : 'Activity'}
                        title={item.title}
                        metadata={[item.centreName ?? item.clubName, item.area].filter(Boolean).join(' · ')}
                        price={formatPriceCents(item.priceCents)}
                        onPress={item.kind === 'game' ? () => router.push(`/(details)/game/${item.id}`) : undefined}
                      />
                    ))}
                    {turn.result.experiences.slice(0, 5).map((experience) => (
                      <CompactActivityRow
                        key={`e-${experience.id}`}
                        imageUrl={experience.imageUrl}
                        category={experience.kind === 'adventure' ? 'Adventure' : 'Experience'}
                        title={experience.title}
                        metadata={`${experience.area}, ${experience.county}`}
                        price={formatPriceCents(experience.priceCents)}
                        onPress={() => router.push(`/(details)/experience/${experience.id}`)}
                      />
                    ))}
                    {turn.result.centres.slice(0, 5).map((centre) => (
                      <CompactActivityRow
                        key={`c-${centre.id}`}
                        imageUrl={centre.image}
                        category="Place"
                        title={centre.name}
                        metadata={`${centre.area}, ${centre.county}`}
                        price={`From ${formatPrice(centre.from)}/hr`}
                        onPress={() => router.push(`/(details)/centre/${centre.id}`)}
                      />
                    ))}
                    {turn.result.clubs.slice(0, 5).map((club) => (
                      <CompactActivityRow
                        key={`cl-${club.id}`}
                        imageUrl={club.image}
                        category="Club"
                        title={club.name}
                        metadata={`${club.area}, ${club.county}`}
                        price={`${formatPrice(club.price)}/${club.unit}`}
                        onPress={() => router.push(`/(details)/club/${club.id}`)}
                      />
                    ))}
                  </View>
                )}
              </View>
            ))}

            {asking && <ThemedText themeColor="textSecondary">Searching…</ThemedText>}
          </ScrollView>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.four, borderTopWidth: 1, borderColor: theme.border }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => send(input)}
              returnKeyType="send"
              placeholder="Ask HelloCircle…"
              placeholderTextColor={theme.textSecondary}
              style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, paddingVertical: 10, color: theme.text }}
            />
            <Pressable
              onPress={() => send(input)}
              disabled={!input.trim() || asking}
              style={{ width: 40, height: 40, borderRadius: Radius.pill, backgroundColor: input.trim() ? theme.primary : theme.border, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}
