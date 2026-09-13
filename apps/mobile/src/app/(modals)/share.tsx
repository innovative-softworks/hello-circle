import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticLight } from '@/lib/haptics';

// Generic real-channel share sheet — WhatsApp/SMS/Email/Copy Link, all via
// standard Linking.openURL schemes, plus an optional QR of the same link.
// One shared route any detail screen can push into with {title, text, link,
// qr?} params, instead of duplicating this per entity (game/circle/centre).
const CHANNELS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; build: (text: string) => string }[] = [
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp', build: (text) => `whatsapp://send?text=${encodeURIComponent(text)}` },
  { key: 'sms', label: 'Messages', icon: 'chatbubble-outline', build: (text) => `sms:&body=${encodeURIComponent(text)}` },
  { key: 'email', label: 'Email', icon: 'mail-outline', build: (text) => `mailto:?subject=${encodeURIComponent('Join me on HelloCircle')}&body=${encodeURIComponent(text)}` },
];

export default function ShareModal() {
  const theme = useTheme();
  const { title, text, link, qr } = useLocalSearchParams<{ title?: string; text?: string; link?: string; qr?: string }>();
  const [copied, setCopied] = useState(false);

  const shareText = text || link || '';
  const shareLink = link || '';

  async function openChannel(build: (text: string) => string) {
    hapticLight();
    const url = build(shareText);
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      Linking.openURL(url);
    } else {
      await Clipboard.setStringAsync(shareText);
      setCopied(true);
    }
  }

  async function copyLink() {
    hapticLight();
    await Clipboard.setStringAsync(shareLink);
    setCopied(true);
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="pageHeading">{title || 'Share'}</ThemedText>
        </View>

        {qr === 'true' && shareLink ? (
          <View style={{ alignItems: 'center', padding: Spacing.four }}>
            <View style={{ backgroundColor: '#fff', padding: Spacing.three, borderRadius: Radius.card }}>
              <QRCode value={shareLink} size={180} />
            </View>
          </View>
        ) : null}

        <View style={{ padding: Spacing.four, gap: Spacing.three }}>
          {CHANNELS.map((channel) => (
            <Pressable
              key={channel.key}
              onPress={() => openChannel(channel.build)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four, borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card }}>
              <Ionicons name={channel.icon} size={24} color={theme.primary} />
              <ThemedText type="cardHeading">{channel.label}</ThemedText>
            </Pressable>
          ))}

          <Pressable
            onPress={copyLink}
            style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four, borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card }}>
            <Ionicons name="link-outline" size={24} color={theme.primary} />
            <ThemedText type="cardHeading">{copied ? 'Link copied ✓' : 'Copy link'}</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}
