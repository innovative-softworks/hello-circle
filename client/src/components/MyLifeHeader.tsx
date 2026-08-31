import { colors, fonts } from "../theme";

// My Life IA redesign — replaces the old MyLifeHero (cover photo + avatar +
// greeting) and MyLifeSummary (4-tile KPI strip) with one typographic
// introduction. Profile identity is secondary to participation here, so
// there's no photo, no avatar, no counts-as-tiles — just the two questions
// this page exists to answer first: what's next, and roughly how much of it
// is there.
//
// Just the text block — the page (MyBookings.tsx) renders this alongside a
// top-right action-button cluster (Find a booking / Sign out / Edit
// profile) in one shared row, since "Find a booking" has to stay reachable
// even for a visitor with no resident account (this component only renders
// when one exists), so that cluster can't live inside this component.

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function MyLifeHeader({
  name, comingUpCount, circlesActiveCount,
}: { name: string; comingUpCount: number; circlesActiveCount: number }) {
  const firstName = name.split(" ")[0] || name;

  const factParts = [
    comingUpCount > 0 ? `${comingUpCount} thing${comingUpCount === 1 ? "" : "s"} coming up` : null,
    circlesActiveCount > 0 ? `${circlesActiveCount} Circle${circlesActiveCount === 1 ? "" : "s"} active` : null,
  ].filter((p): p is string => !!p);

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: colors.mutedLight, marginBottom: 14 }}>
        / MY LIFE
      </div>
      <h1
        style={{
          fontFamily: fonts.display, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.04,
          fontSize: "clamp(32px,5vw,52px)", margin: "0 0 10px", color: colors.text,
        }}
      >
        {greeting()}, {firstName}.
      </h1>
      <p style={{ fontFamily: fonts.display, fontWeight: 600, fontSize: "clamp(17px,2vw,21px)", color: colors.mutedLight, margin: "0 0 16px", maxWidth: 520, lineHeight: 1.3 }}>
        Your next few days, at a glance.
      </p>
      {factParts.length > 0 && (
        <div style={{ fontSize: 13.5, fontWeight: 600, color: colors.textSoft }}>{factParts.join(" · ")}</div>
      )}
    </div>
  );
}
