import { Link } from "react-router-dom";
import type { Centre, Club, Experience, Game, Program } from "../../types";
import "./trust.css";

// Trust & Retention — first-timer and booking confidence. One list of what
// someone needs before they go, built only from what the host or partner
// entered, adapted to each listing type:
//   - a field they could have filled but didn't reads "Not provided by …";
//   - a question that doesn't apply to this kind of listing reads "Not
//     applicable" (e.g. "coming on your own" for a hall hire);
//   - suitability (beginners, on your own, first-timers, accessible) comes
//     only from participation attributes the organiser ticked — an unticked
//     box is "Not provided", never "No" and never "Yes";
//   - prices are per place/person; the total payable is shown at checkout
//     once the booking choices are known.

export type Fact = { label: string; value: string | null | undefined; missing?: string; na?: boolean };

const DAY = new Intl.DateTimeFormat("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" });

function euro(cents: number) {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function duration(min: number | null | undefined) {
  if (!min) return null;
  if (min < 60) return `About ${min} minutes`;
  const h = Math.round((min / 60) * 2) / 2;
  return `About ${h} hour${h === 1 ? "" : "s"}`;
}

const has = (attrs: string[] | undefined, a: string) => !!attrs?.includes(a);
const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Beginners / first time / on your own / who welcomes newcomers / accessibility — shared by every participation type. */
function suitability(attrs: string[] | undefined, opts: { welcome: string | null | undefined; level?: string | null; accessibility?: string | null; who: string }): Fact[] {
  const level = text(opts.level);
  const beginner = has(attrs, "beginner_friendly") || has(attrs, "no_experience");
  return [
    {
      label: "Beginners",
      value: beginner
        ? `Yes — ${opts.who} says ${has(attrs, "no_experience") ? "no experience is needed" : "it's beginner friendly"}`
        : level
          ? /all|beginner/i.test(level)
            ? `Yes — the level is “${level}”`
            : `The level is “${level}”`
          : null,
    },
    { label: "First time here", value: has(attrs, "first_timers_welcome") ? `${cap(opts.who)} says first-timers are welcome` : null },
    { label: "Coming on your own", value: has(attrs, "come_alone") ? `${cap(opts.who)} says people often come on their own` : null },
    {
      label: "Who welcomes newcomers",
      value: text(opts.welcome) ?? (has(attrs, "host_introduces") ? `${cap(opts.who)} says newcomers are introduced at the start (no name given)` : null),
    },
    {
      label: "Accessibility",
      value: text(opts.accessibility) ?? (has(attrs, "accessible") ? `${cap(opts.who)} marked it accessible but gave no details — ask before you go` : null),
    },
  ];
}

export function gameExpectFacts(game: Game): Fact[] {
  const where = [game.centreName ?? game.locationText, game.area].filter(Boolean).join(", ");
  const attrs = game.participationAttributes ?? (game.soloFriendly ? ["come_alone"] : []);
  const s = suitability(attrs, { welcome: game.newcomerWelcome, level: game.skillLevel, accessibility: game.accessibilityInfo, who: "the host" });
  return [
    { label: "Who runs it", value: game.hostName ? `${game.hostName} (host)` : null },
    { label: "When", value: `${DAY.format(new Date(`${game.date}T12:00:00Z`))} at ${game.time}${duration(game.durationMinutes) ? ` · ${duration(game.durationMinutes)}` : " · length not given"}` },
    { label: "Where to meet", value: [where, game.meetingInstructions].filter(Boolean).join("\n") || null },
    { label: "Level", value: text(game.skillLevel) },
    { label: "Experience needed", value: game.experienceRequired ?? null },
    { label: "Age", value: game.minAge ? `${game.minAge}+` : null },
    ...s,
    { label: "What to bring", value: game.equipmentNeeded },
    // Free (0) or paid is chosen explicitly; an older Session with no price says so.
    {
      label: "Price",
      value: game.priceCents == null ? null : game.priceCents > 0 ? `${euro(game.priceCents)} per place. The total, with any fees, is shown before you pay.` : "Free",
    },
    { label: "Cancellation", value: game.cancellationPolicy, missing: "Not provided by the host — ask them before you join" },
  ];
}

export function experienceExpectFacts(e: Experience): Fact[] {
  const volunteer = e.kind === "volunteer";
  const s = suitability(e.participationAttributes, { welcome: e.newcomerWelcome, level: e.difficulty, accessibility: e.accessibilityInfo, who: "the organiser" });
  const facts: Fact[] = [
    { label: "Who runs it", value: e.vendorName },
    { label: "How long", value: duration(e.durationMinutes) },
    { label: "Where to meet", value: text(e.meetingPoint) },
    { label: "Difficulty", value: text(e.difficulty) },
    { label: "Fitness", value: text(e.fitnessRequirements) },
    { label: "Age and requirements", value: [e.minAge ? `${e.minAge}+` : null, text(e.eligibility)].filter(Boolean).join(" · ") || null },
    volunteer ? { label: "Skills needed", value: text(e.skillsRequired) } : { label: "Skills needed", value: null, na: true },
    ...s,
    { label: "What's included", value: text(e.equipmentProvided) },
    { label: "What to bring", value: text(e.equipmentRequired) },
    { label: "Getting there", value: text(e.transportInfo) },
    { label: "If the weather turns", value: text(e.weatherPolicy) },
    volunteer ? { label: "Price", value: null, na: true } : { label: "Price", value: e.priceCents > 0 ? `${euro(e.priceCents)} per person. The total is shown before you pay.` : "Free" },
    { label: "Cancellation", value: text(e.cancellationTerms) },
  ];
  return facts.map((f) => ({ ...f, missing: f.missing ?? "Not provided by the organiser" }));
}

export function programExpectFacts(p: Program): Fact[] {
  const s = suitability(p.participationAttributes, { welcome: p.newcomerWelcome, level: p.skillLevel, accessibility: p.accessibilityInfo, who: "the organiser" });
  const facts: Fact[] = [
    { label: "Who runs it", value: [p.vendorName, p.instructorName ? `instructor ${p.instructorName}` : null].filter(Boolean).join(" · ") || null },
    { label: "Where", value: [p.listingName, p.venueArea].filter(Boolean).join(", ") || null },
    { label: "On arrival", value: text(p.arrivalInstructions) },
    { label: "Level", value: text(p.skillLevel) },
    { label: "Age", value: text(p.ageRange) },
    ...s,
    { label: "What to bring", value: p.equipment.length ? p.equipment.join(", ") : null },
    { label: "Price", value: p.priceCents > 0 ? `${euro(p.priceCents)} for the programme. The total is shown before you pay.` : "Free" },
  ];
  return facts.map((f) => ({ ...f, missing: f.missing ?? "Not provided by the organiser" }));
}

export function centreExpectFacts(c: Centre): Fact[] {
  const facts: Fact[] = [
    { label: "Who runs it", value: text(c.managedBy) },
    { label: "Opening hours", value: c.opensAt && c.closesAt ? `${c.opensAt}–${c.closesAt}` : null },
    { label: "Who meets you on arrival", value: text(c.newcomerWelcome) },
    { label: "Facilities", value: c.amenities.length ? c.amenities.join(", ") : null },
    { label: "Accessibility", value: c.accessibility.length ? c.accessibility.join(", ") : null },
    // A room hire is your own event: these belong to its activities, not the venue.
    { label: "Beginners / coming on your own", value: null, na: true },
    { label: "Price", value: "Depends on the room and time you choose; the total is shown before you pay." },
  ];
  return facts.map((f) => ({ ...f, missing: "Not provided by the venue" }));
}

export function clubExpectFacts(c: Club): Fact[] {
  const s = suitability(c.participationAttributes, { welcome: c.newcomerWelcome, accessibility: c.accessibility.length ? c.accessibility.join(", ") : null, who: "the club" });
  const facts: Fact[] = [
    { label: "Who it's for", value: [c.audience === "adults" ? "Adults" : c.audience === "kids" ? "Children" : null, text(c.ages) ? `ages ${c.ages}` : null].filter(Boolean).join(" · ") || null },
    { label: "Trial", value: c.trial ? "A trial session is offered" : null },
    ...s,
    { label: "What's included", value: c.includes.length ? c.includes.join(", ") : null },
    { label: "Price", value: c.price > 0 ? `€${c.price} per ${c.unit}. The total is shown before you pay.` : null },
  ];
  return facts.map((f) => ({ ...f, missing: "Not provided by the club" }));
}

export function WhatToExpect({ facts, title = "What to expect", contact = "Ask the host from this page once you've joined, or" }: { facts: Fact[]; title?: string; contact?: string }) {
  return (
    <section className="tr-section" aria-labelledby="what-to-expect" style={{ marginTop: 0, marginBottom: 28 }}>
      <h2 id="what-to-expect">{title}</h2>
      <dl className="tr-facts">
        {facts.map((f) => (
          <div key={f.label} style={{ display: "contents" }}>
            <dt>{f.label}</dt>
            <dd className={f.value ? "" : "is-missing"}>{f.value || (f.na ? "Not applicable" : f.missing || "Not provided by the host")}</dd>
          </div>
        ))}
      </dl>
      <p className="tr-note" style={{ marginTop: 12 }}>
        Something unclear? {contact} <Link to="/contact">contact HelloCircle support</Link>.
      </p>
    </section>
  );
}
