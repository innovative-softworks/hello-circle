import { useState } from "react";
import { ApiError } from "../../api/core";
import { joinLaunchWaitlist } from "../../api/public";
import { CheckCircleIcon } from "../icons";
import { colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH, FV_MONO } from "./constants";

// Sits directly below VendorHero's full-bleed photo (see ForVenues.tsx) —
// a second, bigger "coming soon" moment than the slim ComingSoonBanner up
// top, deliberately mirroring VendorFinalCTA's own closing-band structure
// (eyebrow → headline/CTA row → mono utility row → poster-scale line) one
// beat earlier in the page, so a first-time visitor hits the launch news
// before the venue pitch, not only after reading through it.
export function ComingSoonSection() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus("error");
      setError("Enter a valid email");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      await joinLaunchWaitlist({ email: trimmed });
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    }
  }

  return (
    <section style={{ background: colors.dark }}>
      <div className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "64px 24px 56px" }}>
        <div
          className="stack-mobile"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 24, marginBottom: 44 }}
        >
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 10 }}>
              <span aria-hidden="true">/</span> Launching soon
            </div>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 3vw, 32px)", color: "#fff", margin: "0 0 8px", letterSpacing: "-.01em" }}>
              HelloCircle is almost ready.
            </h2>
            <p style={{ margin: 0, color: "rgba(255,255,255,.72)", fontSize: 15.5, maxWidth: 440, lineHeight: 1.6 }}>
              We&rsquo;re putting the finishing touches on it. Dublin and Cork go live first, with more counties to
              follow soon after — leave your email and we&rsquo;ll let you know the moment we open.
            </p>
          </div>

          <div>
            {status === "success" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 14.5 }}>
                <CheckCircleIcon size={17} style={{ color: FV_ACCENT }} /> You&rsquo;re on the list
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div className="stack-mobile" style={{ display: "flex", gap: 10 }}>
                  <input
                    id="fv-coming-soon-section-email"
                    type="email"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    placeholder="you@example.ie"
                    autoComplete="email"
                    aria-label="Email address"
                    style={{
                      border: "1px solid rgba(255,255,255,.25)",
                      outline: "none",
                      borderRadius: 10,
                      padding: "13px 16px",
                      fontSize: 15,
                      minWidth: 220,
                      background: "rgba(255,255,255,.06)",
                      color: "#fff",
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    style={{
                      border: "none",
                      borderRadius: 10,
                      background: FV_ACCENT,
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 15,
                      padding: "13px 24px",
                      cursor: "pointer",
                      opacity: status === "loading" ? 0.7 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {status === "loading" ? "Joining…" : "Notify me"}
                  </button>
                </div>
                {status === "error" && <p style={{ color: "#FFC4B0", fontSize: 13, marginTop: 8 }}>{error}</p>}
              </form>
            )}
          </div>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,.15)", paddingTop: 20 }}>
          <div
            className="stack-mobile"
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              fontFamily: FV_MONO,
              fontSize: 11.5,
              letterSpacing: ".04em",
              color: "rgba(255,255,255,.5)",
              marginBottom: 8,
            }}
          >
            <span>HELLOCIRCLE.IE · IRELAND</span>
            <span>DUBLIN &amp; CORK FIRST</span>
          </div>
          <h3
            style={{
              fontFamily: fonts.display,
              fontWeight: 800,
              fontSize: "clamp(48px, 10vw, 130px)",
              lineHeight: 0.88,
              letterSpacing: "-.03em",
              color: FV_ACCENT,
              margin: 0,
            }}
          >
            Coming soon.
          </h3>
        </div>
      </div>
    </section>
  );
}
