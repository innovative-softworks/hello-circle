import { useNavigate } from "react-router-dom";
import { Button } from "./ui";
import { colors, fonts } from "../theme";

// Brand-new-user state (My Life redesign §36/§56-58) — never 0 plans/0
// Circles/empty charts. Three real, working destinations instead.

const STEPS = [
  { n: "01", title: "Tell us what you like.", cta: "Choose interests", href: "/onboarding" },
  { n: "02", title: "Tell us when you're free.", cta: "Add availability", href: "/onboarding" },
  { n: "03", title: "Join your first plan.", cta: "Find something nearby", href: "/games" },
];

export function MyLifeEmptyState() {
  const navigate = useNavigate();
  return (
    <div>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px,3vw,32px)", letterSpacing: "-.01em", margin: "0 0 24px" }}>
        Make HelloCircle yours.
      </h1>
      <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 32 }}>
        {STEPS.map((s) => (
          <div key={s.n} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, color: colors.faint, marginBottom: 10 }}>{s.n}</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{s.title}</div>
            <Button variant="ghost" onClick={() => navigate(s.href)}>{s.cta}</Button>
          </div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 4px" }}>Circles you might like</h2>
          <p style={{ margin: 0, fontSize: 13.5, color: colors.mutedLight }}>Ongoing local groups built around one shared activity.</p>
        </div>
        <Button onClick={() => navigate("/circles")}>Explore Circles</Button>
      </div>
    </div>
  );
}
