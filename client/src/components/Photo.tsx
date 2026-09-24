import type { CSSProperties, ReactNode } from "react";
import { getMediaUrl, type MediaVariant } from "../media";

interface PhotoProps {
  src: string | undefined;
  alt: string;
  ph: string;
  /** Sizing/shape for the outer box (height, borderRadius, etc). */
  style: CSSProperties;
  /** Layout for the overlay content (e.g. flex + alignment for a badge/label). */
  contentStyle?: CSSProperties;
  /** Fallback glyph shown (in a soft circle) when there's no photo, or it fails to load. */
  icon?: ReactNode;
  iconColor?: string;
  children?: ReactNode;
  /** Which delivery size to request — see client/src/media.ts. Defaults to
   * "card" since the overwhelming majority of call sites are discovery/list
   * cards; pass "hero" for a detail page's primary image, "thumbnail" for a
   * small list-row photo. No effect until a Cloudflare-backed image and
   * VITE_MEDIA_PUBLIC_DOMAIN are both in play — a legacy `/uploads/...` or
   * external URL renders exactly as before either way. */
  variant?: MediaVariant;
  /** Opts out of the default `loading="lazy"` for a genuinely above-the-fold
   * image (a detail page's own hero) — see Image/Media System Audit §15. */
  eager?: boolean;
}

/** A placeholder-gradient box with a real photo layered on top, and optional
 * overlay content (badges/labels) painted above both.
 *
 * Every photo/placeholder gets the same low-opacity duotone wash (`tint`
 * below) — a deliberate, uniform grade so photos shot in wildly different
 * light/color still read as one consistent, "always HelloCircle" surface
 * rather than a grab-bag of random photography. `multiply` blend keeps it
 * feeling like a photographic grade rather than a flat color patch sitting
 * on top; darker at the bottom doubles as legibility support for any
 * overlay badge/label painted there. */
const tintStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(180deg, rgba(20,24,20,.05) 0%, rgba(20,24,20,.22) 100%)",
  mixBlendMode: "multiply",
  pointerEvents: "none",
};

export function Photo({ src, alt, ph, style, contentStyle, icon, iconColor, children, variant = "card", eager }: PhotoProps) {
  const resolvedSrc = getMediaUrl(src, variant);
  return (
    <div style={{ position: "relative", background: ph, overflow: "hidden", ...style }}>
      {icon && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(255,255,255,.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: iconColor,
            }}
          >
            {icon}
          </div>
        </div>
      )}
      {resolvedSrc && (
        <img
          src={resolvedSrc}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <div className="card-photo-tint" style={tintStyle} />
      {children && (
        <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", ...contentStyle }}>
          {children}
        </div>
      )}
    </div>
  );
}
