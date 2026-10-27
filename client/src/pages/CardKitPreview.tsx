import { useEffect, useState, type ReactNode } from "react";
import { fetchGames } from "../api";
import { FeatureCard, type FeatureCardData, type FeatureVariant } from "../components/FeatureCard";
import type { ListingStatusTone } from "../components/ListingCard";
import { CardAction, CardArrow, CardAvailability, CardPrice, ListingCard, ListingCardSkeleton } from "../components/ListingCard";
import { SaveButton } from "../components/SaveButton";
import { CalendarIcon, PinIcon } from "../components/icons";
import { LoadErrorState } from "../components/ui";
import { useUrlParam } from "../useUrlTab";
import { formatPrice } from "../formatters";
import { placeholderStripes } from "../theme";
import type { Game } from "../types";

// Dev-only (routed in App.tsx under import.meta.env.DEV): the card redesign's
// review surface (owner's "Different ways to discover" reference, 2026-10-22)
// — the four large variants, the compact grid card in every state, the
// action buttons and the small interactions. Cards are built from REAL dev
// activities; the state rows override one field each (e.g. spotsLeft = 0) to
// show that state, and say so in their caption.

export function CardKitPreview() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [style, setStyle] = useUrlParam<"all" | CardStyle>("style", "all");
  useEffect(() => {
    fetchGames()
      .then(setGames)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <LoadErrorState title="Couldn't load dev activities for the card kit." />;
  const g = games ?? [];
  const pick = (i: number) => g[i % Math.max(1, g.length)];
  const save = (id: string) => <SaveButton saved={!!saved[id]} onToggle={() => setSaved((s) => ({ ...s, [id]: !s[id] }))} />;

  const feature = (game: Game, over: Partial<FeatureCardData> = {}): FeatureCardData => ({
    href: `/games/${game.id}`,
    title: game.activityLabel,
    image: game.imageUrl,
    ph: placeholderStripes.green,
    category: game.taxonomy?.subcategoryName ?? game.taxonomy?.categoryName ?? sampleCategory(game.activityLabel),
    status: game.spotsLeft <= 2 ? { label: "Almost full", tone: "hot" } : null,
    place: game.centreName ?? game.locationText,
    date: game.date,
    time: game.time,
    durationMinutes: game.durationMinutes ?? null,
    skill: game.skillLevel || null,
    blurb: game.description ?? null,
    going: game.joined,
    price: formatPrice(game.priceCents),
    spotsLeft: game.spotsLeft,
    ...over,
  });

  const states: { label: string; note: string; build: (game: Game) => ReactNode }[] = [
    { label: "Default", note: "real data", build: (x) => grid(x) },
    { label: "New", note: "status: New", build: (x) => grid(x, { status: { label: "New", tone: "new" } }) },
    { label: "Featured", note: "status: Featured", build: (x) => grid(x, { status: { label: "Featured", tone: "featured" } }) },
    { label: "Almost full", note: "spotsLeft → 2", build: (x) => grid({ ...x, spotsLeft: 2 }, { status: { label: "Almost full", tone: "hot" } }) },
    { label: "Paid", note: "price → €10", build: (x) => grid({ ...x, priceCents: 1000 }, {}, <CardAction look="filled" arrow>Join</CardAction>) },
    { label: "Free", note: "outline Join", build: (x) => grid({ ...x, priceCents: 0 }, {}, <CardAction look="outline" arrow>Join</CardAction>) },
    { label: "Waitlist", note: "spotsLeft → 0", build: (x) => grid({ ...x, spotsLeft: 0 }, { status: { label: "Fully booked", tone: "calm" } }, <CardAction look="outline">Join waitlist</CardAction>) },
    { label: "Fully booked", note: "no waitlist", build: (x) => grid({ ...x, spotsLeft: 0 }, { status: { label: "Fully booked", tone: "calm" } }, <CardAction look="booked">Booked</CardAction>) },
    { label: "Cancelled", note: "status: Cancelled", build: (x) => grid(x, { status: { label: "Cancelled", tone: "calm" } }, <CardAction look="booked">Cancelled</CardAction>) },
    { label: "Past session", note: "status: Ended", build: (x) => grid(x, { status: { label: "Ended", tone: "calm" } }, <CardArrow label={`View ${x.activityLabel}`} onClick={() => {}} />) },
    { label: "No image", note: "imageUrl → null", build: (x) => grid({ ...x, imageUrl: null }) },
    { label: "Saved", note: "heart on", build: (x) => grid(x, { save: <SaveButton saved onToggle={() => {}} /> }) },
  ];

  function grid(x: Game, over: { status?: { label: string; tone?: "hot" | "calm" | "new" | "featured" | "popular" } | null; save?: ReactNode } = {}, action?: ReactNode) {
    return (
      <ListingCard
        href={`/games/${x.id}`}
        title={x.activityLabel}
        image={x.imageUrl}
        ph={placeholderStripes.green}
        tag={x.taxonomy?.subcategoryName ?? x.taxonomy?.categoryName ?? sampleCategory(x.activityLabel)}
        fallbackKind="Activity"
        fallbackLine={`${shortDate(x.date)} · ${x.time}`}
        status={"status" in over ? over.status : null}
        save={over.save ?? save(x.id)}
        details={[
          { icon: <CalendarIcon size={13} />, text: `${shortDate(x.date)} · ${x.time}` },
          { icon: <PinIcon size={13} />, text: x.centreName ?? x.locationText },
        ]}
        going={x.joined}
        facts={
          <>
            <CardPrice>{formatPrice(x.priceCents)}</CardPrice>
            <CardAvailability spotsLeft={x.spotsLeft} />
          </>
        }
        action={action ?? <CardArrow label={`View ${x.activityLabel}`} onClick={() => {}} />}
      />
    );
  }

  /** One scenario (Featured, Paid, Waitlist…) in one style. */
  function render(id: CardStyle, sc: Scenario, base: Game): ReactNode {
    const x = sc.game ? { ...base, ...sc.game(base) } : base;
    const key = `${id}-${sc.id}`;
    const action = sc.action?.(x);
    if (id === "compact") return grid(x, { status: sc.status ?? null, save: save(key) }, action);
    return <FeatureCard variant={id} data={feature(x, { status: sc.status ?? null })} save={save(key)} onOpen={() => {}} action={action} />;
  }


  return (
    <div style={{ maxWidth: "var(--page-max, 1560px)", margin: "0 auto", padding: "32px var(--page-gutter, 24px) 80px", display: "grid", gap: 48 }}>
      <header>
        <p style={eyebrow}>Card designs · dev preview</p>
        <h1 style={{ margin: 0, fontSize: "clamp(32px,4vw,52px)", lineHeight: 1 }}>Different ways to discover</h1>
        <p style={{ margin: "10px 0 0", color: "var(--color-muted-light)", maxWidth: 720 }}>
          Five card styles, each shown as Featured, Popular, New, Paid, Free, Almost full, Waitlist and No photo. Cards use real dev activities; the
          caption under each card says which field was changed to show that case. Dev activities have no category yet, so the category
          words (Hiking, Swimming…) are sample values taken from the title; live cards use the listing's real category.
        </p>
      </header>

      <nav aria-label="Card style" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {(["all", ...STYLES.map((x) => x.id)] as ("all" | CardStyle)[]).map((id) => {
          const meta = STYLES.find((x) => x.id === id);
          return (
            <button key={id} type="button" className="chip" aria-pressed={style === id} onClick={() => setStyle(id)} style={chip(style === id)}>
              {meta ? `${meta.n} · ${meta.t}` : "All styles"}
            </button>
          );
        })}
      </nav>

      <section style={{ display: "grid", gap: 16 }}>
        <div>
          <p style={eyebrow}>Same activity, every style</p>
          <p style={{ margin: 0, color: "var(--color-muted-light)", fontSize: 14 }}>One real activity shown in all five styles, so only the design changes.</p>
        </div>
        <div className="fc-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 250px), 1fr))" }}>
          {games === null
            ? STYLES.map((x) => <ListingCardSkeleton key={x.id} />)
            : STYLES.map((x) => (
                <Captioned key={x.id} title={`${x.n} · ${x.t}`} note={x.best}>
                  {render(x.id, SCENARIOS[0], pick(0))}
                </Captioned>
              ))}
        </div>
      </section>

      {STYLES.filter((x) => style === "all" || style === x.id).map((x) => (
        <section key={x.id} style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <div>
              <p style={eyebrow}>Style {x.n}</p>
              <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>{x.t}</h2>
              <p style={{ margin: "6px 0 0", color: "var(--color-muted-light)", fontSize: 14, maxWidth: 640 }}>
                {x.d} <strong style={{ color: "var(--color-text)" }}>Best for:</strong> {x.best}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 14, maxWidth: 640 }}>
                <strong>Used on:</strong> {x.used}
              </p>
            </div>
            {style === "all" ? (
              <button type="button" className="btn-outline" onClick={() => setStyle(x.id)} style={{ padding: "8px 14px", borderRadius: 4, fontWeight: 600, cursor: "pointer" }}>
                Show only this style
              </button>
            ) : null}
          </div>
          <div className={x.id === "compact" ? "listing-grid" : "fc-grid"} style={x.id === "compact" ? undefined : { gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))" }}>
            {games === null
              ? SCENARIOS.map((sc) => <ListingCardSkeleton key={sc.id} />)
              : SCENARIOS.map((sc, i) => (
                  <Captioned key={sc.id} title={sc.label} note={sc.note}>
                    {render(x.id, sc, pick(i))}
                  </Captioned>
                ))}
          </div>
        </section>
      ))}

      <section>
        <p style={eyebrow}>Compact card — every state</p>
        <div className="listing-grid">
          {games === null
            ? Array.from({ length: 8 }, (_, i) => <ListingCardSkeleton key={i} />)
            : states.map((s, i) => (
                <div key={s.label} style={{ display: "grid", gap: 8, gridTemplateRows: "1fr auto" }}>
                  {s.build(pick(i))}
                  <div style={{ fontSize: 13 }}>
                    <strong>{s.label}</strong> <span style={{ color: "var(--color-muted-light)" }}>· {s.note}</span>
                  </div>
                </div>
              ))}
          <div style={{ display: "grid", gap: 8, gridTemplateRows: "1fr auto" }}>
            <ListingCardSkeleton />
            <div style={{ fontSize: 13 }}>
              <strong>Loading</strong> <span style={{ color: "var(--color-muted-light)" }}>· skeleton, same size</span>
            </div>
          </div>
          <div style={{ display: "grid", gap: 8, gridTemplateRows: "1fr auto" }}>
            <div className="listing-card" style={{ justifyContent: "center", padding: 20 }}>
              <LoadErrorState title="We couldn't load this activity." onRetry={() => {}} />
            </div>
            <div style={{ fontSize: 13 }}>
              <strong>Error / unavailable</strong>
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gap: 16 }}>
        <p style={eyebrow}>Button strategy</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
          {[
            { el: <CardAction look="filled" arrow>Join</CardAction>, t: "Primary", d: "Paid / key actions" },
            { el: <CardAction look="outline" arrow>Join</CardAction>, t: "Outline", d: "Free, low-friction, secondary" },
            { el: <CardArrow label="View activity" onClick={() => {}} />, t: "Arrow", d: "Open the listing (labelled)" },
            { el: <CardArrow label="View activity" onClick={() => {}} filled />, t: "Arrow, filled", d: "Featured placements" },
            { el: <CardAction look="neutral">You're in</CardAction>, t: "Neutral", d: "Secondary state (Leave)" },
            { el: <CardAction busy busyLabel="Joining…">Join</CardAction>, t: "Loading", d: "In progress" },
            { el: <CardAction look="booked">Booked</CardAction>, t: "Disabled", d: "Fully booked" },
          ].map((b) => (
            <div key={b.t + b.d} style={{ display: "grid", gap: 8, justifyItems: "start" }}>
              {b.el}
              <div style={{ fontSize: 12.5 }}>
                <strong>{b.t}</strong>
                <div style={{ color: "var(--color-muted-light)" }}>{b.d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const eyebrow = { margin: "0 0 12px", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-orange)" } as const;

type CardStyle = "compact" | FeatureVariant;

const STYLES: { id: CardStyle; n: string; t: string; d: string; best: string; used: string }[] = [
  { id: "compact", n: "1", t: "Compact", d: "Photo, title, date and place, price and action. Easy to compare in a long list.", best: "search results and everyday listing grids.", used: "Every results list and grid; the fallback for every other style." },
  { id: "immersive", n: "2", t: "Immersive", d: "Large photo with the title over it, and a cream action strip.", best: "hero rows and featured picks with strong photos.", used: "Home — \u201cHappening near you\u201d row (listings with a photo)." },
  { id: "editorial", n: "3", t: "Editorial", d: "Clean layout with the date on the side and a short description.", best: "events and dated sessions, \u201cthis weekend\u201d rows.", used: "Explore — \u201cHappening today\u201d and \u201cThis weekend\u201d rows." },
  { id: "adventure", n: "4", t: "Adventure", d: "Wide photo; date, duration and skill level when the listing has them.", best: "experiences, outdoor trips and multi-hour sessions.", used: "Adventures and Experiences — featured listings, above the grid." },
  { id: "bold", n: "5", t: "Bold typography", d: "The category set large over the photo for a branded look.", best: "category landing rows and campaign sections.", used: "Explore, Adventures and Experiences with a category chosen — the first row." },
];

interface Scenario {
  id: string;
  label: string;
  note: string;
  status?: { label: string; tone?: ListingStatusTone } | null;
  game?: (g: Game) => Partial<Game>;
  action?: (g: Game) => ReactNode;
}

const SCENARIOS: Scenario[] = [
  { id: "featured", label: "Featured", note: "status: Featured", status: { label: "Featured", tone: "featured" } },
  { id: "popular", label: "Popular", note: "status: Popular, 12 going", status: { label: "Popular", tone: "popular" }, game: () => ({ joined: 12 }) },
  { id: "new", label: "New", note: "status: New", status: { label: "New", tone: "new" } },
  { id: "paid", label: "Paid", note: "price → €10, filled Join", game: () => ({ priceCents: 1000 }), action: () => <CardAction look="filled" arrow>Join</CardAction> },
  { id: "free", label: "Free", note: "price → free, outline Join", game: () => ({ priceCents: 0 }), action: () => <CardAction look="outline" arrow>Join</CardAction> },
  { id: "almost", label: "Almost full", note: "spotsLeft → 2", status: { label: "Almost full", tone: "hot" }, game: () => ({ spotsLeft: 2 }) },
  { id: "waitlist", label: "Waitlist", note: "spotsLeft → 0", status: { label: "Fully booked", tone: "calm" }, game: () => ({ spotsLeft: 0 }), action: () => <CardAction look="outline">Join waitlist</CardAction> },
  { id: "nophoto", label: "No photo", note: "imageUrl → none", game: () => ({ imageUrl: null }) },
];

function Captioned({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 8, gridTemplateRows: "1fr auto", minWidth: 0 }}>
      {children}
      <div style={{ fontSize: 13 }}>
        <strong>{title}</strong> <span style={{ color: "var(--color-muted-light)" }}>· {note}</span>
      </div>
    </div>
  );
}

function chip(on: boolean) {
  return {
    padding: "8px 14px",
    borderRadius: 999,
    border: `1px solid ${on ? "var(--color-text)" : "var(--color-border-strong)"}`,
    background: on ? "var(--color-text)" : "transparent",
    color: on ? "var(--color-bg)" : "var(--color-text)",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  } as const;
}

function shortDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short" });
}

/** Preview only: dev activities have no category, so name one from the title
 * to show how the category pill and the Bold typography read. */
function sampleCategory(title: string): string {
  const t = title.toLowerCase();
  const map: [string, string][] = [["hik", "Hiking"], ["walk", "Walking"], ["cycl", "Cycling"], ["swim", "Swimming"], ["football", "Football"], ["five-a-side", "Football"], ["chess", "Chess"], ["book", "Books"], ["coffee", "Social"], ["yoga", "Yoga"], ["run", "Running"]];
  return map.find(([k]) => t.includes(k))?.[1] ?? "Activity";
}
