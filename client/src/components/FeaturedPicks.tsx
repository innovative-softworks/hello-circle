import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { fetchCircles, fetchExperiences, fetchGamesPage, fetchProgramBrowse } from "../api";
import { getCircleCoverUrl, getMediaUrl } from "../media";
import { bigDay, gameCardLabel } from "./CardDate";
import "./featuredPicks.css";

// A featured section in the style of Home's "Get outside. Make it happen."
// (owner 2026-10-27): a label, a two-line headline, a short line and a link,
// then up to twelve real listings of one type as C · Title on the photo cards
// in a row that scrolls (five or six in view on a desktop). Each page passes its
// type; the section loads its own picks (with photos only) and renders
// nothing when there aren't at least three.

export type FeaturedKind = "activities" | "adventures" | "experiences" | "circles" | "programmes";


const COPY: Record<FeaturedKind, { label: string; a: string; b: string; copy: string; link: string; to: string }> = {
  activities: { label: "Featured activities", a: "Play together.", b: "Find a game.", copy: "Sessions near you that still have room, from kickabouts to classes.", link: "See all activities", to: "/games" },
  adventures: { label: "Featured adventures", a: "Get outside.", b: "Make it happen.", copy: "Guided hikes, sea days and trips that get you out and about.", link: "See all adventures", to: "/adventures" },
  experiences: { label: "Featured experiences", a: "Try something.", b: "Book a day out.", copy: "Workshops, tours and days out, run by local people.", link: "See all experiences", to: "/experiences" },
  circles: { label: "Featured Circles", a: "Find your people.", b: "Keep showing up.", copy: "Groups that meet regularly around something they love. Free to join.", link: "See all Circles", to: "/circles" },
  programmes: { label: "Featured programmes", a: "Learn something.", b: "Week by week.", copy: "Courses and seasons you sign up for once and keep going to.", link: "See all programmes", to: "/programs" },
};

const place = (...parts: (string | null | undefined)[]) => Array.from(new Set(parts.filter(Boolean))).join(", ");

async function loadPicks(kind: FeaturedKind): Promise<FeaturePick[]> {
  if (kind === "activities") {
    const games = (await fetchGamesPage({ limit: 40 })).items.filter((g) => g.imageUrl && g.spotsLeft > 0 && g.effectiveLifecycle !== "coming_soon");
    // Most in need of people first, then soonest.
    games.sort((a, b) => (a.spotsLeft <= 3 ? 0 : 1) - (b.spotsLeft <= 3 ? 0 : 1) || `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    return games.map((g) => ({
      key: g.id,
      href: `/games/${g.id}`,
      image: getMediaUrl(g.imageUrl, "card"),
      kicker: gameCardLabel(g)?.rest ?? g.taxonomy?.subcategoryName ?? g.taxonomy?.categoryName ?? "Activity",
      title: g.activityLabel,
      line: [`${bigDay(g.date, g.time)} · ${g.time}`, g.centreName ?? g.locationText].filter(Boolean).join(" · "),
    }));
  }
  if (kind === "adventures" || kind === "experiences") {
    const rows = (await fetchExperiences(kind === "adventures" ? "adventure" : "experience")).filter((e) => e.imageUrl);
    rows.sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
    return rows.map((e) => ({
      key: e.id,
      href: `/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.slug ?? e.id}`,
      image: getMediaUrl(e.imageUrl, "card"),
      kicker: e.featured ? `Featured ${e.kind === "adventure" ? "adventure" : "experience"}` : e.difficulty || (e.kind === "adventure" ? "Adventure" : "Experience"),
      title: e.title,
      line: [e.sessions[0] ? `Next ${bigDay(e.sessions[0].date)}` : null, place(e.area, e.county)].filter(Boolean).join(" · "),
    }));
  }
  if (kind === "circles") {
    // Open Circles only: other covers stay members-only.
    const rows = (await fetchCircles()).filter((c) => c.joinMode === "open" && c.status === "active").map((c) => ({ c, cover: getCircleCoverUrl(c) })).filter((x) => !!x.cover);
    rows.sort((a, b) => b.c.members - a.c.members);
    return rows.map(({ c, cover }) => ({
      key: c.id,
      href: `/circles/${c.slug ?? c.id}`,
      image: getMediaUrl(cover!, "card"),
      kicker: c.activityLabel || "Circle",
      title: c.name,
      line: [`${c.members} member${c.members === 1 ? "" : "s"}`, place(c.area, c.county)].filter(Boolean).join(" · "),
    }));
  }
  const rows = (await fetchProgramBrowse()).filter((p) => p.imageUrl);
  rows.sort((a, b) => `${a.nextSessionDate ?? "9"}`.localeCompare(`${b.nextSessionDate ?? "9"}`));
  return rows.map((p) => ({
    key: p.id,
    href: `/programs/${p.id}`,
    image: getMediaUrl(p.imageUrl, "card"),
    kicker: p.category || "Programme",
    title: p.title,
    line: [p.nextSessionDate ? `Starts ${bigDay(p.nextSessionDate)}` : null, place(p.listingName, p.area)].filter(Boolean).join(" · "),
  }));
}

const MAX_PICKS = 12;

/** One card in a featured row. `image` null shows the dark panel. */
export interface FeaturePick {
  key: string;
  href: string;
  image: string | null;
  kicker: string;
  /** Kicker in orange (something to act on soon). */
  hot?: boolean;
  title: string;
  line: string;
}

/** The section heading of a featured section: label, two-line headline,
 * a short line, the "See all" link and, when given, the row's arrows. Also
 * used on its own as a section heading (owner 2026-10-27). */
export function FeatureHead({
  id,
  label,
  a,
  b,
  copy,
  link,
  arrows,
  extra,
  copyIsStatus = false,
  headingLevel = 2,
}: {
  id: string;
  label: string;
  a: string;
  b: string;
  copy?: string;
  link?: { label: string; to: string };
  arrows?: { start: boolean; end: boolean; onPrev: () => void; onNext: () => void };
  /** Anything else beside the link (a view switch, "Use my location"). */
  extra?: React.ReactNode;
  /** The short line changes with filters (a result count): announce it. */
  copyIsStatus?: boolean;
  headingLevel?: 2 | 3;
}) {
  const navigate = useNavigate();
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="fp-head">
      <div>
        <span className="fp-label">/ {label}</span>
        <H id={id} className="fp-title">
          <span>{a}</span> <span className="fp-o">{b}</span>
        </H>
      </div>
      {(copy || link || arrows || extra) && (
        <div className="fp-side">
          {copy && <p role={copyIsStatus ? "status" : undefined}>{copy}</p>}
          <div className="fp-actions">
            {link && (
              <a
                className="fp-link"
                href={link.to}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(link.to);
                }}
              >
                {link.label} <ArrowRight size={16} aria-hidden="true" />
              </a>
            )}
            {extra}
            {arrows && (
              <span className="fp-arrows">
                <button type="button" aria-label={`Previous: ${label.toLowerCase()}`} disabled={arrows.start} onClick={arrows.onPrev}>
                  <ArrowLeft size={16} aria-hidden="true" />
                </button>
                <button type="button" aria-label={`More: ${label.toLowerCase()}`} disabled={arrows.end} onClick={arrows.onNext}>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A featured section: the heading, then a scrolling row of title-on-the-
 * photo cards (five in view on a desktop). */
export function FeatureRow({
  id,
  label,
  a,
  b,
  copy,
  link,
  picks,
  headingLevel = 2,
}: {
  id: string;
  label: string;
  a: string;
  b: string;
  copy?: string;
  link?: { label: string; to: string };
  picks: FeaturePick[];
  headingLevel?: 2 | 3;
}) {
  const navigate = useNavigate();
  const rowRef = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const updateEdge = () => {
    const el = rowRef.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(updateEdge, [picks]);
  // One card per press (the card width plus the gap).
  const step = (dir: 1 | -1) => {
    const el = rowRef.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    el.scrollBy({ left: dir * (card.getBoundingClientRect().width + gap), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const scrolls = !(edge.start && edge.end);
  return (
    <section className="fp" aria-labelledby={id}>
      <FeatureHead
        id={id}
        label={label}
        a={a}
        b={b}
        copy={copy}
        link={link}
        headingLevel={headingLevel}
        arrows={picks.length > 3 && scrolls ? { ...edge, onPrev: () => step(-1), onNext: () => step(1) } : undefined}
      />
      <ul className="fp-cards" ref={rowRef} onScroll={updateEdge} data-no-reveal>
        {picks.map((p) => (
          <li key={p.key}>
            <a
              className="fp-card"
              href={p.href}
              onClick={(e) => {
                e.preventDefault();
                navigate(p.href);
              }}
            >
              <span className={`fp-img${p.image ? "" : " is-empty"}`}>
                {p.image ? <img src={p.image} alt="" loading="lazy" decoding="async" /> : <span className="fp-initial" aria-hidden="true">{p.title.charAt(0)}</span>}
              </span>
              <span className="fp-cap">
                <span className={`fp-k${p.hot ? " is-hot" : ""}`}>{p.kicker}</span>
                <strong>{p.title}</strong>
                {p.line && <small>{p.line}</small>}
                <span className="fp-round" aria-hidden="true">
                  <ArrowRight size={14} />
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FeaturedPicks({ kind, headingLevel = 2 }: { kind: FeaturedKind; headingLevel?: 2 | 3 }) {
  const [picks, setPicks] = useState<FeaturePick[] | null>(null);
  useEffect(() => {
    let live = true;
    loadPicks(kind)
      .then((rows) => {
        // One of each title: three "Five-a-side Football" cards say less than three different things.
        const seen = new Set<string>();
        const distinct = rows.filter((r) => !seen.has(r.title.toLowerCase()) && !!seen.add(r.title.toLowerCase()));
        if (live) setPicks(distinct.slice(0, MAX_PICKS));
      })
      .catch(() => live && setPicks([]));
    return () => {
      live = false;
    };
  }, [kind]);
  if (!picks || picks.length < 3) return null;
  const c = COPY[kind];
  return <FeatureRow id={`fp-${kind}`} label={c.label} a={c.a} b={c.b} copy={c.copy} link={{ label: c.link, to: c.to }} picks={picks} headingLevel={headingLevel} />;
}
