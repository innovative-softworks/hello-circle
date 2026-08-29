import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui";
import { SearchIcon } from "../components/icons";
import { colors, fonts } from "../theme";

// Real 404 (post-audit hardening pass) — the wildcard route used to
// silently redirect to "/" via <Navigate>, so an expired/cancelled link or
// a mistyped URL bounced the visitor home with no explanation. This gives
// a real not-found state with recovery actions instead of a dead end.
export function NotFound() {
  const navigate = useNavigate();

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px 90px", textAlign: "center" }}>
        <div style={{ width: 74, height: 74, borderRadius: "50%", background: colors.orangeBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", color: colors.orangeDark }}>
          <SearchIcon size={30} />
        </div>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>We couldn't find that page</h1>
        <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5, marginBottom: 28 }}>
          The link might be out of date, or the plan, Circle or listing it pointed to may have been removed.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Button variant="primary" onClick={() => navigate("/explore")}>
            Explore what's on
          </Button>
          <Button variant="ghost" onClick={() => navigate("/")}>
            Back home
          </Button>
        </div>
      </section>
    </div>
  );
}
