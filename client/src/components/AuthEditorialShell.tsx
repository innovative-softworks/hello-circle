import type { ReactNode } from "react";
import { AuthBrand } from "./AuthShell";
import { placeholderImage } from "../placeholderImage";
import { colors, fonts } from "../theme";

// Editorial auth shell — brings /login and /signin into the same visual
// language as MyLifeHeader.tsx (My Life's "/ EYEBROW" + big display headline
// + muted subtitle) and VendorHero.tsx (For Venues' accent-colored eyebrow +
// display headline), while keeping a left/right split screen: photo on the
// left (40% — the old AuthShell's own 50/50 split gave the photo more room
// than a functional login page needs), eyebrow/headline/form on the right.
// Reuses AuthShell.tsx's existing `.signin-split`/`.signin-photo-col`/
// `.signin-form-col` CSS (index.css), just with the photo column placed
// first in DOM order instead of second. The photo keeps the old
// AuthPhotoPanel's bottom-gradient caption + avatar-row treatment (`caption`
// prop below) — distinct copy from the right side's headline, not a repeat
// of it.

export function AuthEditorialHeader({
  eyebrow,
  accent,
  headline,
  subtitle,
}: {
  eyebrow: string;
  /** Matches GuidedFlow/Stepper's own accent convention — green for
   * resident-facing screens, orange for vendor-facing ones. */
  accent: "green" | "orange";
  headline: ReactNode;
  subtitle: ReactNode;
}) {
  const accentColor = accent === "orange" ? colors.orange : colors.green;
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: accentColor, marginBottom: 14 }}>
        <span aria-hidden="true">/</span> {eyebrow}
      </div>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(30px,4.6vw,46px)", lineHeight: 1.08, letterSpacing: "-.02em", margin: "0 0 14px" }}>
        {headline}
      </h1>
      <p style={{ fontSize: 15.5, color: colors.mutedLight, lineHeight: 1.55, margin: 0, maxWidth: 460 }}>{subtitle}</p>
    </div>
  );
}

export function AuthEditorialShell({
  heroImage,
  caption,
  contentMaxWidth = 440,
  children,
}: {
  /** Left-column photo — reuse an already-vetted Unsplash URL from
   * Home.tsx or VendorHero.tsx rather than sourcing a new one. */
  heroImage: { src: string; alt: string };
  /** Bottom-gradient overlay text on the photo — same treatment the old
   * AuthPhotoPanel used. Optional so a caption-less photo stays possible. */
  caption?: {
    heading: ReactNode;
    avatarCaption?: string;
    /** Seeds 4 placeholder avatar photos for the social-proof row below
     * avatarCaption — see placeholderImage.ts. */
    avatarSeedPrefix?: string;
  };
  /** Every login/reset/invite screen is a couple of fields — 440 fits.
   * VendorSignup's multi-field intake form needs real room for its own
   * two-column field grid, so it passes a wider value here instead. */
  contentMaxWidth?: number;
  children: ReactNode;
}) {
  const avatarSeeds = caption?.avatarSeedPrefix ? [1, 2, 3, 4].map((n) => `${caption.avatarSeedPrefix}-${n}`) : [];
  return (
    <div className="fade-panel signin-split">
      <div className="signin-photo-col" style={{ position: "relative" }}>
        <img
          src={heroImage.src}
          alt={heroImage.alt}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        {caption && (
          <div
            style={{
              position: "absolute", left: 0, right: 0, bottom: 0, padding: "40px 36px",
              background: "linear-gradient(180deg, rgba(6,8,6,0) 0px, rgba(6,8,6,.82) 90px, rgba(6,8,6,.82) 100%)",
            }}
          >
            <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(22px,2.2vw,28px)", lineHeight: 1.15, letterSpacing: "-.01em", color: "#fff", margin: 0 }}>
              {caption.heading}
            </h2>
            {caption.avatarCaption && avatarSeeds.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
                <div style={{ display: "flex" }}>
                  {avatarSeeds.map((seed, i) => (
                    <img
                      key={seed}
                      src={placeholderImage(seed, 64, 64)}
                      alt=""
                      style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(6,8,6,.82)", marginLeft: i === 0 ? 0 : -10 }}
                      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,.85)", lineHeight: 1.35, maxWidth: 200 }}>{caption.avatarCaption}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="signin-form-col" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "56px 48px" }}>
        <div style={{ maxWidth: contentMaxWidth, width: "100%", margin: "0 auto" }}>
          <AuthBrand />
          {children}
        </div>
      </div>
    </div>
  );
}
