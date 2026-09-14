import { ArrowRightIcon } from "../icons";
import { colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

const STEPS: { n: string; title: string; detail: string }[] = [
  { n: "1", title: "You've got an idea", detail: "A kickabout, a class, a standing group — no venue or business required." },
  { n: "2", title: "You post it", detail: "Pick a time, a spot and a headcount. Live immediately, nothing to approve." },
  { n: "3", title: "People find it", detail: "Residents nearby searching for something to do see it show up." },
  { n: "4", title: "You're hosting", detail: "Real participants join — apply for Verified Host once you're rolling." },
];

// A real left-to-right journey, not a stack of bullet points in a small
// card — explicit arrow connectors between steps make the sequence
// unmissable (per direct feedback that the earlier card version didn't
// read as a flow at all). Full-width, matching this page's other dark
// bands, rather than sharing space with a text column.
export function HostExampleBand() {
  return (
    <section style={{ background: colors.dark }}>
      <div className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "80px 24px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 48, alignItems: "end", marginBottom: 64 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: 14 }}>
              <span style={{ color: FV_ACCENT }}>/</span> No listing required
            </div>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px, 4.6vw, 56px)", lineHeight: 1, letterSpacing: "-.03em", color: "#fff", margin: 0 }}>
              Show up as yourself.
            </h2>
          </div>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,.65)", lineHeight: 1.6, margin: 0 }}>
            You&rsquo;re not building a business — you&rsquo;re just the person who made the plan. Here&rsquo;s
            exactly what happens, start to finish.
          </p>
        </div>

        <div className="stack-mobile" style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
          {STEPS.map((s, i) => (
            <div key={s.n} style={{ display: "flex", alignItems: "stretch", flex: 1 }}>
              <div style={{ flex: 1, padding: "0 8px" }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    border: `1.5px solid ${FV_ACCENT}`,
                    color: FV_ACCENT,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: fonts.display,
                    fontWeight: 800,
                    fontSize: 16,
                    marginBottom: 18,
                  }}
                >
                  {s.n}
                </div>
                <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 19, color: "#fff", marginBottom: 8 }}>{s.title}</div>
                <p style={{ fontSize: 13.5, color: "rgba(255,255,255,.62)", lineHeight: 1.55, margin: 0 }}>{s.detail}</p>
              </div>
              {i < STEPS.length - 1 && (
                <div className="for-venues-flow-arrow" style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 8, color: "rgba(255,255,255,.25)", flex: "none" }}>
                  <ArrowRightIcon size={20} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
