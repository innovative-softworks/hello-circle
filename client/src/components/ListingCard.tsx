import type { CSSProperties, ReactNode } from "react";
import { Photo } from "./Photo";
import { CardLink, Skeleton } from "./ui";
import { ArrowRight, Flame, Sparkles, Star, Timer, Users } from "lucide-react";
import { cardImageRatio, fonts } from "../theme";
import { euro } from "../euro";
import "./listingCard.css";

// ListingCard — the one card shape for every listing across the app.
// Redesigned 2026-10-22 to the owner's "Different ways to discover" grid
// reference: 16:10 photo with a status pill top-left (coloured icon), the
// save heart top-right and the category pill bottom-left; a 2-line title,
// one-line details, an optional real "N going" line, then price +
// availability left and a compact orange outline arrow (or a short worded
// action) right. Card corners stay 16px (owner). Each card component keeps
// its own data and actions and passes them in. Styles: listingCard.css.
//
//   status top-left · save top-right · category bottom-left
//   title · details · going · footer (price + availability | arrow/action)

export interface ListingCardDetail {
  icon?: ReactNode;
  text: ReactNode;
  tone?: "default" | "hot";
  /** "date" for the when-line: the photo card look hides it, since the
   * big date on the photo already says it. */
  kind?: "date";
}

/** Photo status pill tones (card redesign, 2026-10-22 reference): white pill,
 * coloured icon + label. `hot` = urgency (almost full), `calm` = neutral
 * state (Full, Coming soon, Past), `new`, `featured`, `popular`. */
export type ListingStatusTone = "hot" | "calm" | "new" | "featured" | "popular";

export const STATUS_ICON: Record<ListingStatusTone, ReactNode> = {
  hot: <Timer size={12} strokeWidth={2.4} aria-hidden="true" />,
  calm: null,
  new: <Sparkles size={12} strokeWidth={2.4} aria-hidden="true" />,
  featured: <Star size={12} strokeWidth={2.4} aria-hidden="true" />,
  popular: <Flame size={12} strokeWidth={2.4} aria-hidden="true" />,
};

export function ListingCard({
  href,
  title,
  image,
  imageAlt,
  ph,
  icon,
  iconColor,
  tag,
  status,
  save,
  details,
  going,
  facts,
  action,
  children,
  headingLevel = 3,
  noPhoto = "typographic",
  fallbackKind,
  fallbackLine,
  kicker,
  dateOn,
  word,
}: {
  href: string;
  title: string;
  /** Title heading level. 3 under a section heading (the default); 2 when the
   * cards sit directly under the page's H1 (no skipped levels, HC-QA-083). */
  headingLevel?: 2 | 3;
  image?: string | null;
  imageAlt?: string;
  /** Placeholder background when there's no photo. */
  ph: string;
  icon?: ReactNode;
  iconColor?: string;
  /** Category/type, shown as a small pill bottom-left of the photo. */
  tag?: ReactNode;
  /** Status (e.g. "2 spots left", "New", "Full"), a pill top-left of the photo. */
  status?: { label: ReactNode; tone?: ListingStatusTone } | null;
  /** A <SaveButton/> (absolutely positioned top-right). */
  save?: ReactNode;
  details?: (ListingCardDetail | null | false | undefined)[];
  /** Real participant count only ("8 going") — hidden when null/0. Never
   * invented, and no avatars (the data has no participant photos). */
  going?: number | null;
  /** Price + availability — bold, bottom-left. */
  facts?: ReactNode;
  /** Bottom-right: a <CardArrow/> (open) or a compact <CardAction/> (Join,
   * Join waitlist, Booked…). */
  action?: ReactNode;
  children?: ReactNode;
  /** @deprecated kept for call-site compatibility (cards no longer morph). */
  sharedImage?: boolean;
  /** What a card with no photo shows: the listing's own category, name and
   * (optionally) date on a category colour ("typographic", the default), or
   * the older soft icon on the placeholder ("icon"). */
  noPhoto?: "typographic" | "icon";
  /** Category for the no-photo block when `tag` isn't it (e.g. a date pill). */
  fallbackKind?: string | null;
  /** Short line for the no-photo block, e.g. "Sat 24 Oct · 13:00". */
  fallbackLine?: string | null;
  /** @deprecated the redesigned card is full-width on phones (brief §7). */
  rowOnPhone?: boolean;
  /** Small coloured line above the title (e.g. the category), My Life style.
   * Without it the photo card look uses `tag`; `false` for none (e.g. when the
   * tag is a date, which the photo already shows). */
  kicker?: ReactNode | false;
  /** The big date on the photo, bottom left (My Life style): pass a label,
   * the big day and the time. Shown with a dark fade under it. */
  dateOn?: ReactNode;
  /** The listing's category set large across the top of the photo (owner,
   * 2026-10-28: the Bold typography on every listing card, the card itself
   * unchanged). Decorative — the same category is in the text below. */
  word?: string | null;
}) {
  const typographic = !image && noPhoto === "typographic";
  const tone = status?.tone ?? "hot";
  return (
    <div className="listing-card card-surface">
      <CardLink to={href} label={title} />
      <Photo
        src={image ?? undefined}
        alt={imageAlt ?? title}
        ph={typographic ? noPhotoTone(ph) : ph}
        icon={typographic ? undefined : icon}
        iconColor={iconColor}
        style={{ aspectRatio: cardImageRatio.discovery, ...(word ? { containerType: "inline-size" } : null) }}
      >
        {typographic ? <NoPhotoText kind={word ? null : fallbackKind ?? (typeof tag === "string" ? tag : null)} title={title} line={fallbackLine ?? null} /> : null}
        {word ? (
          <span className="lc-word" aria-hidden="true" style={{ ["--chars" as string]: Math.max(4, word.length) }}>
            {word}
          </span>
        ) : null}
        {status ? (
          <span className="lc-status" data-tone={tone}>
            {STATUS_ICON[tone]}
            {status.label}
          </span>
        ) : null}
        {tag && !typographic ? <span className="lc-tag card-photo-badge">{tag}</span> : null}
        {dateOn ? (
          <>
            <span className="lc-photo-fade" aria-hidden="true" />
            <span className="lc-date-on">{dateOn}</span>
          </>
        ) : null}
        {save}
      </Photo>
      <div className="lc-body">
        {/* The photo card look shows the category above the title; the
            boxed look keeps it as the photo pill (`tag`). */}
        {kicker === false ? null : kicker ? <span className="lc-kicker">{kicker}</span> : tag ? <span className="lc-kicker lc-kicker--tag">{tag}</span> : null}
        {headingLevel === 2 ? <h2 className="lc-title">{title}</h2> : <h3 className="lc-title">{title}</h3>}
        {details
          ?.filter((d): d is ListingCardDetail => !!d)
          .map((d, i) => (
            <div key={i} className="lc-detail" data-tone={d.tone === "hot" ? "hot" : undefined} data-kind={d.kind}>
              {d.icon ? <span className="lc-detail-icon">{d.icon}</span> : null}
              <span className="lc-detail-text">{d.text}</span>
            </div>
          ))}
        {going ? (
          <div className="lc-going">
            <Users size={14} strokeWidth={2} aria-hidden="true" />
            {going} going
          </div>
        ) : null}
        {children}
        {(facts || action) && (
          <div className="lc-footer">
            <div className="lc-facts">{facts}</div>
            {action ? <div className="stretched-link-above lc-action-slot">{action}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** A grid of cards in the photo card look (My Life style, option B; owner
 * 2026-10-27): no box, a rounded 4:3 photo with the big date and its label
 * (`dateOn`, see CardDate) and the action as a white pill on the photo, then
 * the category, the title, one muted line and price / places. Every
 * ListingCard inside takes this look; the same cards elsewhere stay boxed.
 * `rail` for a horizontal row instead of the results grid. */
export function CardGrid({ children, rail = false, className, style }: { children: ReactNode; rail?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div className={[rail ? null : "listing-grid", "lc-grid--b", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}

/** Open the listing — the compact square arrow (reference "outline arrow").
 * `filled` for featured placements. Always labelled for screen readers. */
export function CardArrow({ label, onClick, filled = false }: { label: string; onClick: () => void; filled?: boolean }) {
  return (
    <button type="button" className={`lc-arrow${filled ? " lc-arrow--filled" : ""}`} aria-label={label} title={label} onClick={onClick}>
      <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

/** A compact card action with words (Join, Join waitlist, Notify me, Booked).
 * `filled` = paid / key action, `outline` = free / low-friction, `neutral` =
 * secondary (Leave), `booked` = disabled grey. Loading shows `busyLabel`. */
export function CardAction({
  children,
  onClick,
  look = "outline",
  disabled,
  busy,
  busyLabel,
  arrow = false,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  look?: "filled" | "outline" | "neutral" | "booked";
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  arrow?: boolean;
  ariaLabel?: string;
}) {
  const off = look === "booked" || disabled || busy;
  return (
    <button type="button" className={`lc-act lc-act--${look}`} disabled={off} aria-busy={busy || undefined} aria-label={ariaLabel} onClick={off ? undefined : onClick}>
      {busy ? busyLabel ?? children : children}
      {arrow && !busy && look !== "booked" ? <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" /> : null}
    </button>
  );
}

/** Real availability, toned: few left = orange, plenty = green, full = muted.
 * `spotsLeft` must be real data; pass null to show nothing. */
export function CardAvailability({ spotsLeft, few = 3 }: { spotsLeft: number | null | undefined; few?: number }) {
  // One phrasing everywhere (price rules, owner 2026-10-27): "8 left",
  // orange from 3 down, "Full" when none.
  if (spotsLeft === null || spotsLeft === undefined) return null;
  if (spotsLeft <= 0) return <span className="lc-avail" data-tone="full">Full</span>;
  return (
    <span className="lc-avail" data-tone={spotsLeft <= few ? "few" : "good"}>
      {spotsLeft} left
    </span>
  );
}

// Batch 2 — no-photo block. The listing's own category, name and date on a
// category colour, never an unrelated stock photo. Tones are fixed (they sit
// where a photo would, like the photo pills) and keep white text ≥ 9.5:1 and
// the peach date line ≥ 5.5:1. The tone follows the placeholder colour each
// card already passes (green = sport/outdoor, orange = social/experience,
// blue = learning), so no call site has to change.
const NO_PHOTO_TONES = { green: "#1f4d36", orange: "#6b2a1a", blue: "#2b3a59", neutral: "#172019" } as const;

function noPhotoTone(ph: string): string {
  const p = ph.toLowerCase();
  if (p.includes("green") || p.includes("dde8da")) return NO_PHOTO_TONES.green;
  if (p.includes("orange") || p.includes("f5e1d3")) return NO_PHOTO_TONES.orange;
  if (p.includes("blue") || p.includes("d9e6ec")) return NO_PHOTO_TONES.blue;
  return NO_PHOTO_TONES.neutral;
}

function NoPhotoText({ kind, title, line }: { kind: string | null; title: string; line: string | null }) {
  return (
    <div className="no-photo-text" aria-hidden="true" style={noPhotoTextStyle}>
      <span className="no-photo-kind" style={noPhotoKindStyle}>{kind ?? ""}</span>
      <span className="no-photo-title" style={noPhotoTitleStyle}>{title}</span>
      <span className="no-photo-line" style={noPhotoLineStyle}>{line ?? ""}</span>
    </div>
  );
}

const noPhotoTextStyle: CSSProperties = { position: "absolute", inset: 0, padding: "40px 16px 14px", display: "flex", flexDirection: "column", justifyContent: "space-between", color: "#fff", pointerEvents: "none" };
const noPhotoKindStyle: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.85, minHeight: 13 };
const noPhotoTitleStyle: CSSProperties = { fontFamily: fonts.display, fontSize: 22, fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.01em", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" };
const noPhotoLineStyle: CSSProperties = { fontSize: 12.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#ffb39f", minHeight: 15 };

/** The compact card button (same as the original CentreCard/ClubCard CTA). */
export const cardButtonStyle: CSSProperties = { padding: "8px 16px", fontSize: 13 };

/** Price in the shared card style (bold, body colour). */
/** The price tag (owner 2026-10-27, price rules): the amount in bold, its
 * unit in lighter text ("per person", "for 6 sessions", "an hour"), "From"
 * before it when rooms differ. Free is the word "Free", same tag, green;
 * never a pill of its own and never "€0". Whole euros show no ".00".
 * `children` is the older free-text form, kept for a few previews. */
export function CardPrice({ cents, unit, from = false, children }: { cents?: number | null; unit?: string | null; from?: boolean; children?: ReactNode }) {
  if (children !== undefined && cents === undefined) return <span className="lc-price"><b>{children}</b></span>;
  const free = !cents;
  return (
    <span className={`lc-price${free ? " is-free" : ""}`}>
      {from && !free ? <span>From</span> : null}
      <b>{free ? "Free" : euro(cents! / 100)}</b>
      {unit && !free ? <span>{unit}</span> : null}
    </span>
  );
}

/** "per person" / "an hour" / "a term": the unit after a price. */
export function priceUnitFor(kind: string | null | undefined): string | undefined {
  switch (kind) {
    case "game":
    case "experience":
    case "experience_session":
    case "adventure":
      return "per person";
    case "club_session":
    case "program_session":
      return "per session";
    default:
      return undefined;
  }
}

/** Loading placeholder with the card's real proportions (16:10 photo, title,
 * two detail lines, footer) so nothing jumps when results arrive. */
export function ListingCardSkeleton() {
  return (
    <div className="listing-card lc-skeleton" aria-hidden="true">
      <div className="skeleton lc-skeleton-photo" style={{ borderRadius: 0 }} />
      <div className="lc-body">
        <Skeleton width="78%" height={18} style={{ marginBottom: 6 }} />
        <Skeleton width="60%" height={13} />
        <Skeleton width="48%" height={13} />
        <div className="lc-footer">
          <Skeleton width={70} height={16} />
          <Skeleton width={40} height={40} radius={4} />
        </div>
      </div>
    </div>
  );
}
