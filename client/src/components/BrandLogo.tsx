import type { CSSProperties } from "react";
import { useTheme } from "../ThemeContext";

// HC-QA-072 — the wordmark's text colour is baked into Logo.svg (#3c150e,
// 1.1:1 on the dark header). Dark theme uses a variant whose wordmark text is
// light (#f3e9e4, ~14.9:1); the orange mark is unchanged in both.
export function BrandLogo({ alt, style, decorative = false }: { alt?: string; style?: CSSProperties; decorative?: boolean }) {
  const { resolvedTheme } = useTheme();
  const src = resolvedTheme === "dark" ? "/illustrations/Logo-dark.svg" : "/illustrations/Logo.svg";
  return decorative ? <img src={src} alt="" aria-hidden="true" style={style} /> : <img src={src} alt={alt ?? "HelloCircle"} style={style} />;
}
