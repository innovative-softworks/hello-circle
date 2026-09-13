import { useState } from "react";
import { ApiError } from "../../api/core";
import { joinLaunchWaitlist } from "../../api/public";
import { CheckCircleIcon } from "../icons";
import { fonts } from "../../theme";
import { FV_ACCENT, FV_ACCENT_DARK, FV_MAX_WIDTH } from "./constants";

// Purely additive to /for-venues (see ForVenues.tsx — this is prepended
// above VendorHero, nothing else on that page changes): this page is now
// doing double duty as the pre-launch landing page, so visitors who aren't
// a venue owner (the page's actual audience) still get somewhere to leave
// an email before the "List your venue" pitch below. Shares the same
// launch_signups capture as pages/ComingSoon.tsx (server/src/routes/
// launchSignups.ts) — one waitlist, not two.
export function ComingSoonBanner() {
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
    <div style={{ background: FV_ACCENT, color: "#fff" }}>
      <div
        className="section-pad stack-mobile"
        style={{
          maxWidth: FV_MAX_WIDTH,
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, lineHeight: 1.4 }}>
          Hello Circle launches soon in Dublin &amp; Cork.
        </div>

        {status === "success" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13.5 }}>
            <CheckCircleIcon size={16} /> You&rsquo;re on the list
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              id="fv-coming-soon-email"
              type="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              placeholder="you@example.ie"
              autoComplete="email"
              aria-label="Email address"
              style={{ border: "none", outline: "none", borderRadius: 999, padding: "9px 14px", fontSize: 13.5, minWidth: 200, fontFamily: "inherit" }}
            />
            <button
              type="submit"
              disabled={status === "loading"}
              style={{
                border: "none",
                borderRadius: 999,
                background: "#fff",
                color: FV_ACCENT_DARK,
                fontWeight: 800,
                fontSize: 13.5,
                padding: "9px 18px",
                cursor: "pointer",
                opacity: status === "loading" ? 0.7 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {status === "loading" ? "Joining…" : "Notify me"}
            </button>
            {status === "error" && <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>{error}</span>}
          </form>
        )}
      </div>
    </div>
  );
}
