import type { ChatMessage, ChatScopeType } from '@hello-circle/types';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';

import { fetchChatMessages, postChatMessage } from '@/api/chat';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticLight } from '@/lib/haptics';

const POLL_MS = 4000;

// Mirrors client/src/components/ChatPanel.tsx's exact polling shape — no
// WebSocket/real-time infra exists anywhere in this stack (a deliberate,
// documented choice), so this is plain 4-second polling, cursor-based via
// the last message's id, same as web.
export function ChatPanel({ scopeType, scopeId }: { scopeType: ChatScopeType; scopeId: string }) {
  const theme = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [postBlockedReason, setPostBlockedReason] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const lastIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const feed = await fetchChatMessages(scopeType, scopeId, lastIdRef.current);
        if (cancelled) return;
        if (feed.messages.length) {
          setMessages((prev) => [...prev, ...feed.messages]);
          lastIdRef.current = feed.messages[feed.messages.length - 1].id;
        }
        setCanPost(feed.canPost);
        setPostBlockedReason(feed.postBlockedReason);
        setLoaded(true);
      } catch {
        // Stale membership check on the caller's side (e.g. left the
        // Circle/game between screens) — render nothing rather than an
        // error, same contract as web. request()'s ApiError carries no
        // status code, so any failure here is treated the same way.
        if (!cancelled) setForbidden(true);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scopeType, scopeId]);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const message = await postChatMessage(scopeType, scopeId, body);
      setMessages((prev) => [...prev, message]);
      lastIdRef.current = message.id;
      setDraft('');
      hapticLight();
    } finally {
      setSending(false);
    }
  }

  if (forbidden || !loaded) return null;

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="sectionHeading">Chat</ThemedText>
      <FlatList
        data={messages}
        keyExtractor={(item) => String(item.id)}
        style={styles.list}
        renderItem={({ item }) => (
          <View style={styles.message}>
            <Avatar name={item.residentName} size={28} />
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText type="smallBold">{item.residentName}</ThemedText>
              <ThemedText>{item.body}</ThemedText>
            </View>
          </View>
        )}
        ListEmptyComponent={<ThemedText themeColor="textSecondary">No messages yet.</ThemedText>}
      />
      {canPost ? (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          />
          <Button label="Send" onPress={handleSend} loading={sending} disabled={!draft.trim()} />
        </View>
      ) : (
        <ThemedText themeColor="textSecondary">{postBlockedReason ?? "Chat isn't open right now."}</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 240,
  },
  message: {
    flexDirection: 'row',
    paddingVertical: Spacing.one,
    gap: Spacing.two,
  },
  composer: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.two,
  },
});
