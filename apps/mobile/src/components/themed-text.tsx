import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code'
    // Editorial scale (spec §5) — added on top of the set above rather than
    // replacing it, so no existing call site had to change.
    | 'hero'
    | 'pageHeading'
    | 'sectionHeading'
    | 'cardHeading'
    | 'metadata'
    | 'eyebrow'
    // Big standalone statement types, above pageHeading in the scale — same
    // Bricolage Grotesque display face as everything else, just bigger.
    // Never use these for dense/functional UI text.
    | 'editorial'
    | 'campaign';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        {
          color:
            theme[
              themeColor ??
                (type === 'metadata' || type === 'eyebrow'
                  ? 'textSecondary'
                  : type === 'linkPrimary'
                    ? 'primary'
                    : 'text')
            ],
        },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        type === 'hero' && styles.hero,
        type === 'pageHeading' && styles.pageHeading,
        type === 'sectionHeading' && styles.sectionHeading,
        type === 'cardHeading' && styles.cardHeading,
        type === 'metadata' && styles.metadata,
        type === 'eyebrow' && styles.eyebrow,
        type === 'editorial' && styles.editorial,
        type === 'campaign' && styles.campaign,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontFamily: Fonts.body,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontFamily: Fonts.displaySemibold,
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontFamily: Fonts.displaySemibold,
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    fontFamily: Fonts.body,
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    fontFamily: Fonts.body,
    lineHeight: 30,
    fontSize: 14,
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
  // Big editorial statements — "Sunset Yoga by the River", onboarding
  // messaging. Same Bricolage Grotesque ExtraBold as web's brand display
  // scale, not a separate mobile typeface.
  hero: {
    fontFamily: Fonts.displayExtraBold,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  // Section-introduction statements — "Go somewhere you haven't been."
  // One step up from pageHeading in the scale.
  editorial: {
    fontFamily: Fonts.displayExtraBold,
    fontSize: 38,
    lineHeight: 42,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  // The largest standalone statements — splash/onboarding campaign moments.
  // Reserve for one statement per screen.
  campaign: {
    fontFamily: Fonts.displayExtraBold,
    fontSize: 56,
    lineHeight: 60,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  // Page-level editorial headings — "Explore Dublin", "Circles".
  pageHeading: {
    fontFamily: Fonts.display,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: 700,
    letterSpacing: -0.3,
  },
  // Rail/section titles — "Happening Today", "This Weekend" — one step below
  // pageHeading.
  sectionHeading: {
    fontFamily: Fonts.display,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 700,
  },
  // Card/feature titles, distinct from body text.
  cardHeading: {
    fontFamily: Fonts.display,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: 700,
  },
  // Date/location/price lines under a title.
  metadata: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 500,
  },
  // Small uppercase section labels with tracking — TODAY, NEAR YOU, THIS
  // WEEKEND (spec §37's "Editorial Labels" signature).
  eyebrow: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
