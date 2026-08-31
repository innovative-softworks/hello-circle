import { colors, fonts, radius } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

const INTENTS = ["“Badminton tonight”", "“Five-a-side this weekend”", "“Somewhere for a hall”"];

// Each step is a real sentence explaining what happens, not a bare
// label/value pair (the previous "Local intent → 'Badminton tonight'"
// treatment read as cryptic shorthand rather than an actual explanation).
const STEPS: { title: string; detail: string }[] = [
  {
    title: "Someone looks for something to do",
    detail: "A resident searches, or just says what they're after — like “badminton tonight.”",
  },
  {
    title: "HelloCircle matches it locally",
    detail: "We check that against open plans, Circles and venues nearby — including yours.",
  },
  {
    title: "Your real availability shows up",
    detail: "If you've got a free slot — say, Court 2 at 19:00 — it surfaces right there.",
  },
  {
    title: "They book, you get a participant",
    detail: "Not just a page view — a real booking or sign-up lands on your dashboard.",
  },
];

// The page's one full-bleed dark band (matching the app-wide convention of
// a single strong contrast beat — see Home.tsx's own colors.dark sections)
// — this is where the "more than a listing" argument gets made loudest.
export function VendorDifference() {
  return (
    <section style={{ background: colors.dark }}>
      <div className="section-pad grid-responsive" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "72px 24px", display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 48, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 14 }}>
            More than a listing
          </div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(30px, 4.2vw, 48px)", lineHeight: 1.02, letterSpacing: "-.02em", color: "#fff", margin: "0 0 20px" }}>
            Be where local
            <br />
            plans start.
          </h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,.72)", lineHeight: 1.6, margin: "0 0 22px", maxWidth: 420 }}>
            People don't always start by searching for a venue — they start with an idea. HelloCircle
            connects that intent to activities, Circles and your place.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {INTENTS.map((q) => (
              <span
                key={q}
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,.28)",
                  borderRadius: radius.pill,
                  padding: "6px 12px",
                }}
              >
                {q}
              </span>
            ))}
          </div>
        </div>

        <div
          style={{
            background: colors.surface,
            borderRadius: radius.card,
            padding: 26,
            boxShadow: "0 30px 60px rgba(0,0,0,.35)",
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 18 }}>
            From an idea to a booking
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {STEPS.map((s, i) => (
              <div key={s.title} style={{ display: "flex", gap: 14 }}>
                <div
                  style={{
                    flex: "none",
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: FV_ACCENT,
                    color: "#fff",
                    fontFamily: fonts.display,
                    fontWeight: 700,
                    fontSize: 12.5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, color: colors.text, marginBottom: 3 }}>{s.title}</div>
                  <p style={{ fontSize: 13.5, color: colors.textSoft, lineHeight: 1.5, margin: 0 }}>{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
