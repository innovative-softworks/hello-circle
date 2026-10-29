import type { ReactNode } from "react";
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bike,
  Bookmark,
  BookOpen,
  Calendar,
  CalendarDays,
  ChartColumn,
  Check,
  Coffee,
  Dumbbell,
  Footprints,
  Globe,
  Heart,
  House,
  Images,
  Info,
  Lock,
  MapPin,
  MessageSquare,
  Mountain,
  Music,
  Palette,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  Camera,
  Waves,
  Zap,
} from "lucide-react";
import { dateLabel } from "../../euro";
import { getCircleCoverUrl } from "../../media";
import type { Circle, CirclePlanPreview } from "../../types";
import { ShareSheet } from "../ShareSheet";
import { ActionMenu, type ActionMenuItem } from "../ActionMenu";
import { useSavedState } from "../SaveButton";
import { CompactRow } from "../CompactRow";
import { cardLabel } from "../CardDate";
import { Avatar, Button } from "../ui";
import type { CircleTabKey } from "./CircleFirstTime";

// Circle Home, reference layout (owner, 2026-10-23) — the parts that are
// only presentation: the photo banner, the icon tab bar, section headings,
// the "Next up" rows and the rail cards. Everything they show is real Circle
// data; nothing here invents a count, a badge or a face. Behaviour (joining,
// Pulse, plans, chat, memories, free time) stays in the existing components.

export type CircleMember = { residentId: string; name: string; role: string };

const JOIN_MODE_SHORT: Record<Circle["joinMode"], string> = { open: "Public circle", approval: "Ask to join", invite: "Invite only" };
const JOIN_MODE_LONG: Record<Circle["joinMode"], string> = {
  open: "Open — anyone can join",
  approval: "Ask to join — an organiser approves",
  invite: "Invite only",
};

/** A recognisable icon for an activity name; a neutral one when nothing matches. */
export function activityIcon(label: string, size = 22): ReactNode {
  const l = label.toLowerCase();
  const pick = (re: RegExp) => re.test(l);
  if (pick(/hik|walk|ramble|trek/)) return <Footprints size={size} />;
  if (pick(/coffee|tea|brunch|chat|social|meetup/)) return <Coffee size={size} />;
  if (pick(/cycl|bike|biking/)) return <Bike size={size} />;
  if (pick(/photo|camera/)) return <Camera size={size} />;
  if (pick(/swim|sea|kayak|surf|paddle|row|sail/)) return <Waves size={size} />;
  if (pick(/run|gym|fitness|yoga|pilates|football|tennis|badminton|padel|sport/)) return <Dumbbell size={size} />;
  if (pick(/music|choir|sing|band/)) return <Music size={size} />;
  if (pick(/art|paint|draw|craft|sketch/)) return <Palette size={size} />;
  if (pick(/book|read/)) return <BookOpen size={size} />;
  if (pick(/climb|mountain|boulder/)) return <Mountain size={size} />;
  return <Sparkles size={size} />;
}

function createdLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", { month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

function MemberStack({ members, total, size }: { members: CircleMember[]; total: number; size: number }) {
  const shown = members.slice(0, 4);
  const more = Math.max(0, total - shown.length);
  if (shown.length === 0) return null;
  return (
    <div className="ch-stack" aria-hidden="true">
      {shown.map((m) => (
        <span key={m.residentId} style={{ display: "inline-flex" }}>
          <Avatar name={m.name} size={size} />
        </span>
      ))}
      {more > 0 && (
        <span className="ch-stack-more" style={{ width: size, height: size }}>
          +{more > 99 ? "99" : more}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- banner
export function CircleBanner({
  circle,
  activeThisWeek,
  cover: coverOverride,
  variant = "banner",
  nextLine,
}: {
  circle: Circle;
  activeThisWeek: boolean;
  /** Visitor page: a non-open Circle's cover stays members-only, so pass null. */
  cover?: string | null;
  /** "editorial" (owner 2026-10-26): the My Life look — title in big type,
   * the same facts as plain text, the cover photo under it. Same content. */
  variant?: "banner" | "editorial";
  /** Editorial only: one line about what's next, e.g. the next meetup. */
  nextLine?: ReactNode;
}) {
  const navigate = useNavigate();
  const cover = coverOverride === undefined ? getCircleCoverUrl(circle) : coverOverride;
  const closed = circle.status === "closed";
  const place = [circle.area, circle.county].filter(Boolean).join(", ") || "Ireland";
  const tagline = circle.about ? circle.about.split(/\n/)[0] : "";
  const tags = [circle.taxonomy?.subcategoryName, ...(circle.tags ?? [])].filter((t): t is string => !!t).slice(0, 6);
  if (variant === "editorial") {
    return (
      <section className="ch-ed" aria-labelledby="circle-title">
        <button type="button" className="ch-ed-back" onClick={() => navigate("/circles")}>
          <ArrowLeft size={14} aria-hidden="true" /> Back to Circles
        </button>
        <div className="ch-ed-head">
          <div className="ch-ed-avatar">{cover ? <img src={cover} alt="" /> : <Avatar name={circle.name} size={132} />}</div>
          {/* Everything under the title shares its left edge. */}
          <div className="ch-ed-main">
            <div className="ch-ed-toprow">
              <p className="ch-ed-label">
                Circle · {place} · {JOIN_MODE_SHORT[circle.joinMode]}
              </p>
              {closed ? <span className="ch-ed-badge ch-ed-badge--muted">Closed circle</span> : activeThisWeek ? <span className="ch-ed-badge">Active this week</span> : null}
            </div>
            <h1 id="circle-title" className="ch-ed-title">{circle.name}</h1>
            {nextLine && <p className="ch-ed-next">{nextLine}</p>}
            <p className="ch-ed-facts">
              {circle.activityLabel && <span>{circle.activityLabel}</span>}
              <span>Created {createdLabel(circle.createdAt)}</span>
            </p>
            {tagline && <p className="ch-ed-tagline">{tagline}</p>}
            {tags.length > 0 && (
              <div className="ch-ed-tags" aria-label="Tags">
                {tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        {cover && (
          <div className="ch-ed-cover">
            <img src={cover} alt="" />
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="ch-banner" aria-labelledby="circle-title">
      {cover && <img className="ch-banner-img" src={cover} alt="" />}
      <div className="ch-banner-inner">
        <div>
          <button type="button" className="ch-back" onClick={() => navigate("/circles")}>
            <ArrowLeft size={15} aria-hidden="true" /> Back to Circles
          </button>
        </div>
        <div className="ch-identity">
          <div className="ch-avatar">{cover ? <img src={cover} alt="" /> : <Avatar name={circle.name} size={132} />}</div>
          <div className="ch-identity-text">
            <h1 id="circle-title">{circle.name}</h1>
            <p className="ch-facts">
              {circle.activityLabel && (
                <span>
                  <Users size={14} aria-hidden="true" /> {circle.activityLabel}
                </span>
              )}
              <span>
                <MapPin size={14} aria-hidden="true" /> {place}
              </span>
              <span>
                {circle.joinMode === "open" ? <Globe size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />} {JOIN_MODE_SHORT[circle.joinMode]}
              </span>
              <span>
                <Calendar size={14} aria-hidden="true" /> Created {createdLabel(circle.createdAt)}
              </span>
              {closed ? <span className="ch-status ch-status--muted">Closed circle</span> : activeThisWeek ? <span className="ch-status">Active this week</span> : null}
            </p>
            {tagline && <p className="ch-tagline">{tagline}</p>}
            {tags.length > 0 && (
              <div className="ch-tags" aria-label="Tags">
                {tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- tab bar
const TAB_ICONS: Record<CircleTabKey, ReactNode> = {
  home: <House size={16} aria-hidden="true" />,
  activities: <CalendarDays size={16} aria-hidden="true" />,
  discussions: <MessageSquare size={16} aria-hidden="true" />,
  polls: <ChartColumn size={16} aria-hidden="true" />,
  members: <Users size={16} aria-hidden="true" />,
  memories: <Images size={16} aria-hidden="true" />,
  about: <Info size={16} aria-hidden="true" />,
};

/** Same tab semantics as SectionTabs (ids match TabPanel), with icons. */
export function CircleTabBar({ tabs, labels, value, onChange, actions, counts }: { tabs: CircleTabKey[]; labels: Record<CircleTabKey, string>; value: CircleTabKey; onChange: (t: CircleTabKey) => void; actions?: ReactNode; counts?: Partial<Record<CircleTabKey, number>> }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (e: ReactKeyboardEvent, i: number) => {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next]);
    refs.current[tabs[next]]?.focus();
  };
  return (
    <div className="ch-tabbar">
      <div className="ch-tabbar-row">
        <div role="tablist" aria-label="Circle sections">
          {tabs.map((k, i) => (
            <button
              key={k}
              ref={(el) => {
                refs.current[k] = el;
              }}
              type="button"
              role="tab"
              className="ch-tab"
              id={`circle-tab-${k}`}
              aria-selected={k === value}
              aria-controls={`circle-panel-${k}`}
              tabIndex={k === value ? 0 : -1}
              onClick={() => onChange(k)}
              onKeyDown={(e) => move(e, i)}
            >
              {TAB_ICONS[k]} {labels[k]}
              {counts?.[k] !== undefined && counts[k]! > 0 && <span className="ch-tab-count">{counts[k]}</span>}
            </button>
          ))}
        </div>
        {actions && <div className="ch-tab-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Chat / Share / Save / Report behind one "…" menu at the end of the tab
 * row (owner, 2026-10-24). Chat only for members (the Circle chat is theirs). */
export function CircleActions({
  circle,
  saved,
  onToggleSave,
  alreadyReported,
  onReport,
  onOpenChat,
}: {
  circle: Circle;
  saved: boolean;
  onToggleSave: () => void;
  alreadyReported: boolean;
  onReport: () => void;
  /** Members only; omitted for everyone else. */
  onOpenChat?: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const items: ActionMenuItem[] = [
    ...(onOpenChat ? [{ label: "Open Circle chat", onSelect: onOpenChat }] : []),
    { label: "Share", onSelect: () => setSharing(true) },
    { label: saved ? "Remove from saved" : "Save", onSelect: onToggleSave },
    alreadyReported ? { label: "Reported", onSelect: () => {}, disabled: true } : { label: "Report this Circle", onSelect: onReport, danger: true },
  ];
  return (
    <>
      <ActionMenu label={`More for ${circle.name}`} appearance="icon" items={items} />
      <ShareSheet open={sharing} onClose={() => setSharing(false)} entityType="circle" entityId={circle.id} />
    </>
  );
}

// ---------------------------------------------------------------- sections
export function HomeSection({
  id,
  icon,
  title,
  sub,
  action,
  children,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void } | null;
  children: ReactNode;
}) {
  return (
    <section className="ch-section" id={id}>
      <div className="ch-head">
        <div>
          <h2>
            <span className="ch-head-icon" aria-hidden="true">
              {icon}
            </span>
            {title}
          </h2>
          {sub && <p>{sub}</p>}
        </div>
        {action && (
          <button type="button" className="ch-see-all" onClick={action.onClick}>
            {action.label} →
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- next up
function dayParts(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-IE", { ...o, timeZone: "Europe/Dublin" });
  return { weekday: f({ weekday: "short" }), day: f({ day: "numeric" }), month: f({ month: "short" }) };
}

/** C · Title on the photo (card styles, owner 2026-10-27): the featured
 * activity's photo, taller, with "Next up", the title and the date written on
 * it over a dark fade. No photo: a forest-green panel with the activity's icon
 * (the text stays readable and on brand). `chips` sit top left. */
export function FeaturedPhoto({ image, activityLabel, kicker, title, line, chips }: { image: string | null; activityLabel: string; kicker: string; title: string; line: string; chips?: ReactNode }) {
  return (
    <div className={`nu-img nu-img--c${image ? "" : " is-empty"}`}>
      {image ? <img src={image} alt="" loading="lazy" /> : <span className="nu-img-icon">{activityIcon(activityLabel, 56)}</span>}
      {chips ? <span className="nu-chips">{chips}</span> : null}
      <span className="nu-on">
        <span className="nu-on-k">{kicker}</span>
        <strong>{title}</strong>
        <span className="nu-on-d">{line}</span>
      </span>
    </div>
  );
}

/** One Circle activity as a compact row (D · Compact rows, owner 2026-10-27):
 * photo with the date on it, the label, title, one line, Join and Save. */
export function NextUpRow({ plan, circleImage }: { plan: CirclePlanPreview; circleImage: string | null }) {
  const navigate = useNavigate();
  const [saved, toggleSaved] = useSavedState("game", plan.id);
  const place = plan.centreName || plan.locationText;
  const full = plan.spotsLeft <= 0;
  const href = `/games/${plan.id}`;
  return (
    <CompactRow
      href={href}
      onOpen={() => navigate(href)}
      image={plan.imageUrl || circleImage}
      fallbackIcon={activityIcon(plan.activityLabel, 26)}
      date={plan.date}
      time={plan.time}
      label={circlePlanLabel(plan)}
      title={plan.activityLabel}
      meta={[place, `${plan.joined} going`, full ? "Full" : `${plan.spotsLeft} ${plan.spotsLeft === 1 ? "place" : "places"} left`].filter(Boolean).join(" · ")}
      action={
        <span className="ch-next-actions">
          {full || plan.joinedByMe ? (
            <button type="button" className="ch-btn-accent" onClick={() => navigate(href)} style={{ minWidth: 96 }}>
              View
            </button>
          ) : (
            <Button onClick={() => navigate(href)} style={{ minWidth: 96 }}>
              Join
            </Button>
          )}
          <button type="button" className="ch-btn-icon" aria-pressed={saved} aria-label={saved ? `Saved: ${plan.activityLabel}` : `Save ${plan.activityLabel}`} onClick={toggleSaved}>
            <Bookmark size={17} aria-hidden="true" fill={saved ? "currentColor" : "none"} />
          </button>
        </span>
      }
    />
  );
}

/** A Circle activity's label, same rules as every card (CardDate.tsx). */
export function circlePlanLabel(plan: { date: string; time: string; spotsLeft: number; joined: number; capacity?: number | null; soloFriendly?: boolean | null; experienceRequired?: string | null; durationMinutes?: number | null; joinedByMe?: boolean; waitlistedByMe?: boolean; joinRequested?: boolean }) {
  return cardLabel({
    joinedByMe: plan.joinedByMe,
    waitlistedByMe: plan.waitlistedByMe,
    joinRequested: plan.joinRequested,
    date: plan.date,
    time: plan.time,
    durationMinutes: plan.durationMinutes,
    spotsLeft: plan.spotsLeft,
    joined: plan.joined,
    capacity: plan.capacity,
    firstTimeFriendly: !!plan.soloFriendly && !plan.experienceRequired,
  });
}

// ---------------------------------------------------------------- rail cards
export function CircleDetailsCard({ circle }: { circle: Circle }) {
  const navigate = useNavigate();
  const place = [circle.area, circle.county].filter(Boolean).join(", ") || "Ireland";
  const category = circle.taxonomy ? [circle.taxonomy.categoryName, circle.taxonomy.subcategoryName].filter(Boolean).join(" · ") : circle.activityLabel;
  return (
    <div className="ch-card">
      <h3>
        <MapPin size={17} aria-hidden="true" style={{ color: "var(--color-cta)" }} /> Circle details
      </h3>
      <dl className="ch-details">
        {category && (
          <>
            <dt>
              <Tag size={15} aria-hidden="true" /> Category
            </dt>
            <dd>{category}</dd>
          </>
        )}
        <dt>
          <MapPin size={15} aria-hidden="true" /> Location
        </dt>
        <dd>{place}</dd>
        <dt>
          <Users size={15} aria-hidden="true" /> Membership
        </dt>
        <dd>{JOIN_MODE_LONG[circle.joinMode]}</dd>
        <dt>
          <Calendar size={15} aria-hidden="true" /> Created
        </dt>
        <dd>{new Date(circle.createdAt).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "Europe/Dublin" })}</dd>
        {circle.hostName && (
          <>
            <dt>
              <ShieldCheck size={15} aria-hidden="true" /> Organised by
            </dt>
            <dd>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Avatar name={circle.hostName} size={28} />
                <span>
                  {circle.hostVerified ? (
                    <button type="button" className="ce-link" style={{ padding: 0, minHeight: 0 }} onClick={() => navigate(`/host/${circle.createdByResidentId}`)}>
                      {circle.hostName}
                    </button>
                  ) : (
                    <strong>{circle.hostName}</strong>
                  )}
                  <span style={{ display: "block", fontSize: 12, color: "var(--color-muted-light)" }}>Organiser{circle.hostVerified ? " · Host application approved" : ""}</span>
                </span>
              </span>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function RailMembersCard({ members, total, onSeeAll, showTip }: { members: CircleMember[]; total: number; onSeeAll: () => void; showTip: boolean }) {
  if (total === 0) return null;
  return (
    <div className="ch-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>
          <Users size={17} aria-hidden="true" style={{ color: "var(--color-cta)" }} /> Members ({total.toLocaleString()})
        </h3>
        <button type="button" className="ch-see-all" onClick={onSeeAll}>
          See all →
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <MemberStack members={members} total={total} size={36} />
      </div>
      {showTip && (
        <div className="ch-tip">
          <Users size={20} aria-hidden="true" style={{ color: "var(--color-green-text)", flex: "none" }} />
          <div>
            <strong>Meet new people</strong>
            Say hello in the discussions or join an upcoming activity.
          </div>
        </div>
      )}
    </div>
  );
}

/** The organiser's own values, one line each. Only when they wrote some. */
export function CircleGuidelinesCard({ circle }: { circle: Circle }) {
  const lines = (circle.values ?? "")
    .split(/\n|;|•/)
    .map((l) => l.replace(/^[-*\s]+/, "").trim())
    .filter((l) => l.length > 1);
  if (lines.length < 2) return null;
  return (
    <div className="ch-card" id="circle-guidelines">
      <h3>
        <ShieldCheck size={17} aria-hidden="true" style={{ color: "var(--color-cta)" }} /> Circle guidelines
      </h3>
      <ul className="ch-guidelines">
        {lines.slice(0, 6).map((l) => (
          <li key={l}>
            <Check size={15} aria-hidden="true" /> {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CircleCommunity({ circle }: { circle: Circle }) {
  type Col = { icon: ReactNode; label: string; value: string };
  const cols: Col[] = ([
    circle.about ? { icon: <Sparkles size={20} aria-hidden="true" />, label: "Our mission", value: circle.about } : null,
    circle.whatWeDo ? { icon: <Footprints size={20} aria-hidden="true" />, label: "What we do", value: circle.whatWeDo } : null,
    circle.whoCanJoin ? { icon: <Users size={20} aria-hidden="true" />, label: "Who can join", value: circle.whoCanJoin } : null,
    circle.values ? { icon: <Heart size={20} aria-hidden="true" />, label: "Our values", value: circle.values } : null,
  ] as (Col | null)[]).filter((c): c is Col => c !== null);
  if (cols.length === 0) return null;
  return (
    <div className="ch-community">
      {cols.map((c) => (
        <div key={c.label}>
          {c.icon}
          <h3>{c.label}</h3>
          <p>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

export type QuickAction = { icon: ReactNode; label: string; onClick?: () => void; render?: (content: ReactNode) => ReactNode };

/** `status` — a slim line on top (e.g. "You're a member" with its menu), so
 * membership shows without a card of its own (owner, 2026-10-24). */
export function QuickActionsCard({ actions, status }: { actions: QuickAction[]; status?: ReactNode }) {
  if (actions.length === 0 && !status) return null;
  return (
    <div className="ch-card">
      {status && <div className="ch-status-row">{status}</div>}
      <h3>
        <Zap size={17} aria-hidden="true" style={{ color: "var(--color-cta)" }} /> Quick actions
      </h3>
      <ul className="ch-actions-list">
        {actions.map((a) => {
          const content = (
            <>
              {a.icon} {a.label}
            </>
          );
          return (
            <li key={a.label}>
              {a.render ? (
                a.render(content)
              ) : (
                <button type="button" onClick={a.onClick}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- circle pulse (owner 2026-10-26)
export type CirclePulseRow = { key: string; source: string; title: string; sub: string; action: ReactNode; hot?: boolean };

/** What needs a member's attention in this Circle: an open poll, unread
 * chat, wishes (totals only). Same data the page already loads. */
export function CirclePulseRows({ rows }: { rows: CirclePulseRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="ch-section ch-pulse" aria-labelledby="ch-pulse-title">
      <div className="ch-head">
        <div>
          <h2 id="ch-pulse-title">
            <span className="ch-head-icon" aria-hidden="true">
              <Zap size={22} />
            </span>
            Circle pulse
          </h2>
        </div>
      </div>
      <ul className="ch-pulse-list">
        {rows.map((r) => (
          <li key={r.key}>
            <span className={r.hot ? "ch-pulse-src is-hot" : "ch-pulse-src"}>{r.source}</span>
            <span className="ch-pulse-main">
              <strong>{r.title}</strong>
              <span>{r.sub}</span>
            </span>
            <span className="ch-pulse-act">{r.action}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
