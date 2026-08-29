import { useNavigate } from "react-router-dom";
import { Avatar, Button } from "./ui";
import { colors, fonts } from "../theme";

// Compact, image-led personal hero (My Life redesign §6/§7) — same
// already-in-use Unsplash activity photography Home.tsx's own hero carousel
// draws from (HERO_IMAGES), not a fresh/fabricated source. Kept short —
// this is a greeting, not the page's main visual anchor, so the photo band
// stays well under a landing-page hero's height.

const HERO_IMAGE = "https://images.unsplash.com/photo-1551632811-561732d1e306?w=1600&q=70&auto=format&fit=crop";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function MyLifeHero({ name, subtitle }: { name: string; subtitle: string }) {
  const navigate = useNavigate();
  const firstName = name.split(" ")[0] || name;

  return (
    <div
      style={{
        position: "relative", borderRadius: 16, overflow: "hidden", minHeight: 172,
        background: `linear-gradient(180deg, rgba(20,26,20,.15) 0%, rgba(16,20,16,.72) 100%), url(${HERO_IMAGE})`,
        backgroundSize: "cover", backgroundPosition: "50% 40%",
      }}
    >
      <div style={{ position: "absolute", top: 18, right: 18 }}>
        <Button variant="ghost" onClick={() => navigate("/profile")} style={{ background: "rgba(255,255,255,.92)" }}>
          Edit profile
        </Button>
      </div>
      <div style={{ position: "relative", padding: "24px 24px 22px", display: "flex", alignItems: "center", gap: 16, minHeight: 172, boxSizing: "border-box" }}>
        <div style={{ borderRadius: "50%", padding: 3, background: "#fff", flex: "none" }}>
          <Avatar name={name} size={54} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,.85)", textTransform: "uppercase", letterSpacing: ".04em" }}>{greeting()}</div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(22px,2.8vw,28px)", letterSpacing: "-.01em", margin: "2px 0 4px", color: "#fff" }}>
            {firstName} 👋
          </h1>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.8)" }}>{subtitle}</div>
        </div>
      </div>
    </div>
  );
}
