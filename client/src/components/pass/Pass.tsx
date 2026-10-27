import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import "./pass.css";

// The pass you show up with (owner 2026-10-27, "HelloCircle Passes"
// artifact): what a booking becomes once you're in. One structure, three
// looks — the owner kept all three:
//   wallet  — coloured header per type, fields in a grid, code at the bottom.
//             The activity booking box.
//   ticket  — a torn-off stub with the code. The "You're booked" pages.
//   lanyard — your name first, like a badge at the door. Clubs,
//             volunteering and Circle meetups.
// The code holds the booking reference (the same text staff look up today);
// a pass with no reference (free activities, Circle meetups) says you're on
// the list instead. A pass whose payment is still being checked shows the
// code greyed out and never says "booked".

export type PassLook = "wallet" | "ticket" | "lanyard";
export type PassKind = "activity" | "experience" | "adventure" | "volunteer" | "programme" | "room" | "club" | "circle" | "pass";
export type PassTone = "ok" | "warn" | "hot" | "live" | "bad" | "wait" | "ended" | "host";

const KIND_LABEL: Record<PassKind, string> = {
  activity: "Activity",
  experience: "Experience",
  adventure: "Adventure",
  volunteer: "Volunteering",
  programme: "Programme",
  room: "Room booking",
  club: "Club",
  circle: "Circle meetup",
  pass: "Session pass",
};

export interface PassProps {
  look: PassLook;
  kind: PassKind;
  tone: PassTone;
  /** The status pill: "You're going", "Payment being checked", … */
  status: string;
  title: string;
  /** Small line above (lanyard) or before the name: "Admit", "Registered by …". */
  whoLabel?: string;
  who?: string | null;
  /** Display strings: "Sun 1 Nov", "18:30 – 20:00". */
  date?: string | null;
  time?: string | null;
  where?: ReactNode;
  fields?: [string, ReactNode][];
  note?: ReactNode;
  /** The booking reference; shown as text and as a scannable code. */
  reference?: string | null;
  /** What the code holds when it isn't the reference itself (an activity
   * pass: "HCG:<gameId>:<residentId>", see ScanPassModal's readPassCode). */
  code?: string | null;
  /** False while a payment is being checked: the code is greyed out. */
  codeActive?: boolean;
  /** Shown in the stub when there's no reference. */
  listLine?: { title: string; text: string };
  /** A rotated stamp over the stub ("Checked in · 18:24", "Completed"). */
  stamp?: string | null;
  progress?: { done: number; total: number } | null;
  /** Heading level of the title (h2 inside a page that has its own h1). */
  as?: "h2" | "h3";
  /** Main action, icons, quiet link — in that order. */
  children?: ReactNode;
}

/** The booking reference as an SVG code (qrcode library). */
function useCodeSvg(text: string | null | undefined): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return setSvg(null);
    let live = true;
    QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [text]);
  return svg;
}

export function Pass({ look, kind, tone, status, title, whoLabel, who, date, time, where, fields, note, reference, code, codeActive = true, listLine, stamp, progress, as = "h2", children }: PassProps) {
  const payload = code ?? reference ?? null;
  const svg = useCodeSvg(payload);
  const Title = as;
  return (
    <article className={`hc-pass hc-pass--${look} hc-pass-tone-${tone}`} data-kind={kind} aria-label={`${KIND_LABEL[kind]} pass: ${status}`}>
      <header className="hc-pass-top">
        <span>{KIND_LABEL[kind]}</span>
        <span className="hc-pass-brand">HelloCircle</span>
      </header>
      <div className="hc-pass-main">
        <span className="hc-pass-status">
          <i aria-hidden="true" />
          {status}
        </span>
        <Title className="hc-pass-title">{title}</Title>
        {who && (
          <div className="hc-pass-who">
            {whoLabel ?? "Admit"} <b>{who}</b>
          </div>
        )}
        {(date || time) && (
          <div className="hc-pass-when">
            {date && <span className="hc-pass-date">{date}</span>}
            {time && <span className="hc-pass-time">{time}</span>}
          </div>
        )}
        {where && <div className="hc-pass-where">{where}</div>}
        {progress && progress.total > 1 && (
          <div className="hc-pass-progress" role="img" aria-label={`${progress.done} of ${progress.total} sessions done`}>
            {Array.from({ length: progress.total }, (_, i) => (
              <span key={i} className={i < progress.done ? "on" : i === progress.done ? "now" : undefined} />
            ))}
          </div>
        )}
        {!!fields?.length && (
          <dl className="hc-pass-fields">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {note && <p className="hc-pass-note">{note}</p>}
      </div>
      <div className="hc-pass-stub">
        {payload ? (
          <>
            <div className={`hc-pass-code${codeActive ? "" : " is-dim"}`} aria-hidden="true" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
            <div className="hc-pass-reflabel">{!codeActive ? "Not active yet" : reference ? "Reference" : "Show at check-in"}</div>
            {reference ? <div className="hc-pass-ref">{reference}</div> : listLine ? <div className="hc-pass-list">{listLine.text}</div> : null}
          </>
        ) : listLine ? (
          <div className="hc-pass-list">
            <b>{listLine.title}</b>
            {listLine.text}
          </div>
        ) : null}
        {stamp && <span className="hc-pass-stamp">{stamp}</span>}
      </div>
      {children && <footer className="hc-pass-actions">{children}</footer>}
    </article>
  );
}

/** "Sun 1 Nov" from "YYYY-MM-DD" (Ireland). */
export function passDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" }).replace(",", "");
}

/** "18:30 – 20:00" when the length is known, else "18:30". */
export function passTime(time: string, durationMinutes?: number | null): string {
  if (!durationMinutes) return time;
  const [h, m] = time.split(":").map(Number);
  const end = h * 60 + m + durationMinutes;
  return `${time} – ${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}
