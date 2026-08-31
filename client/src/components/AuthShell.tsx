import type { AuthIntentContext } from "../authRedirect";
import { colors } from "../theme";

// AuthBrand/AuthContextCard are shared by every full-page auth screen —
// resident (/signin, /signin/create, /signin/email-link) and vendor/admin
// (/login, /forgot-password, /reset-password, /accept-invite). The shell
// itself (the split-screen layout these two sit inside) now lives in
// AuthEditorialShell.tsx — this file's own AuthShell/AuthPhotoPanel split-
// screen (logo + form column, photo column with a bottom-anchored gradient
// caption) was the previous version of that shell; every call site has
// since moved to AuthEditorialShell (Form System Audit follow-up), so it
// was removed here rather than left as unused dead code.

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

