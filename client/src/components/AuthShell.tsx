import type { ReactNode } from "react";
import type { AuthIntentContext } from "../authRedirect";
import { colors, fonts, stripedPlaceholder } from "../theme";

// Shared shell for every full-page authentication screen — resident
// (/signin, /signin/create, /signin/email-link) and vendor/admin (/login):
// 45/55ish split, logo top-left, no floating card (the form sits directly
// on the page per the auth redesign brief's own "don't over-card the UI"
// rule), photography column on the right with a bottom-anchored gradient +
// message. Mobile collapses to form-only via the existing .signin-split
// CSS (client/src/index.css) — no separate mobile markup needed.

export function AuthBrand() {
  return (
    <div style={{ marginBottom: 40 }}>
      <img src="/illustrations/Logo.svg" alt="HelloCircle" style={{ height: 34, display: "block" }} />
    </div>
  );
}

// Small "here's what you're about to do" card, rendered above the form on
// every full-page auth screen when the trigger that sent someone here knew
// what they were joining (see authRedirect.ts's AuthIntentContext). Nothing
// invents this — it's only shown when a real call site (CircleJoinCard,
// GameJoinCard, ...) supplied real data about a real Circle/game.
export function AuthContextCard({ context }: { context: AuthIntentContext }) {
  return (
    <div style={{ background: colors.panel, borderRadius: 12, padding: "13px 16px", marginBottom: 24, maxWidth: 340 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 5 }}>
        You're joining
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, color: colors.text }}>{context.title}</div>
      {(context.meta || context.badge) && (
        <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 3, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span>{context.meta}</span>
          {context.badge && <span style={{ fontWeight: 700, color: colors.orangeDark, flex: "none" }}>{context.badge}</span>}
        </div>
      )}
    </div>
  );
}

export function AuthShell({ children, photo }: { children: ReactNode; photo: ReactNode }) {
  return (
    <div className="fade-panel signin-split">
      <div className="signin-form-col" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "56px 48px" }}>
        <div style={{ maxWidth: 420, width: "100%", margin: "0 auto" }}>
          <AuthBrand />
          {children}
        </div>
      </div>
      {photo}
    </div>
  );
}

export function AuthPhotoPanel({
  imageSeed,
  heading,
  sub,
  avatarCaption,
  avatarSeedPrefix,
}: {
  imageSeed: string;
  heading: ReactNode;
  sub?: string;
  avatarCaption?: string;
  avatarSeedPrefix?: string;
}) {
  const avatarSeeds = avatarSeedPrefix ? [1, 2, 3, 4].map((n) => `${avatarSeedPrefix}-${n}`) : [];
  return (
    <div className="signin-photo-col" style={{ position: "relative", background: stripedPlaceholder("#DDE8DA", "#E6EEE3", 18) }}>
      <img
        src={`https://picsum.photos/seed/${imageSeed}/1200/1400`}
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
      <div
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, padding: "48px 44px",
          background: "linear-gradient(180deg, rgba(6,8,6,0) 0px, rgba(6,8,6,.82) 90px, rgba(6,8,6,.82) 100%)",
        }}
      >
        <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px,2.6vw,32px)", lineHeight: 1.15, letterSpacing: "-.01em", color: "#fff", margin: 0 }}>
          {heading}
        </h2>
        {sub && <p style={{ margin: "10px 0 0", fontSize: 14, color: "rgba(255,255,255,.85)" }}>{sub}</p>}
        {avatarCaption && avatarSeeds.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
            <div style={{ display: "flex" }}>
              {avatarSeeds.map((seed, i) => (
                <img
                  key={seed}
                  src={`https://picsum.photos/seed/${seed}/64/64`}
                  alt=""
                  style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(6,8,6,.82)", marginLeft: i === 0 ? 0 : -10 }}
                  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                />
              ))}
            </div>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,.85)", lineHeight: 1.35, maxWidth: 200 }}>{avatarCaption}</span>
          </div>
        )}
      </div>
    </div>
  );
}
