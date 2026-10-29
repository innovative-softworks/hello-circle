import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { QrCode } from "lucide-react";
import { ApiError, doorCheckIn, doorLookup, doorUndo, fetchDoorSession, fetchDoorSessions, type DoorSessionListItem } from "../api";
import { useAuth } from "../AuthContext";
import { PartnerWorkspace } from "../components/workspace/PartnerWorkspace";
import { Button, EmptyState, LoadErrorState, PageSpinner, RouteLinkButton } from "../components/ui";
import { ScanPassModal, readPassCode, type ScanResult } from "../components/pass/ScanPassModal";
import { CheckIcon, SearchIcon, UsersIcon } from "../components/icons";
import { dateLabel } from "../euro";
import { colors, fonts, radius } from "../theme";
import type { DoorBooking, DoorSessionInfo } from "../types";
import { answerLabel, optionNote } from "../components/experience/attendeeSlots";

// Participation Phase 2 — door check-in (docs/participation-expansion/12 §5).
//
// /vendor/door            — the dates this person can check people in for,
//                           inside the partner workspace (the only workspace
//                           page the Check-in only role has).
// /vendor/door/:sessionId — the door screen itself: phone first, one hand,
//                           big targets. Scan a pass or search by name, then
//                           tick who is arriving (a group can arrive in parts).
//                           Shows names, person type, guardian, option and the
//                           answers people were told the door sees; never
//                           amounts or contact details (the API doesn't send them).

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });

export function VendorDoorHome() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<{ today: string; sessions: DoorSessionListItem[] } | null>(null);
  const [error, setError] = useState<"off" | "failed" | null>(null);
  const load = () => {
    setError(null);
    fetchDoorSessions()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "off" : "failed"));
  };
  useEffect(() => {
    if (!loading && (!user || user.role !== "vendor")) navigate("/login");
    else if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);
  if (loading) return <PageSpinner />;
  if (!user || user.role !== "vendor") return null;
  return (
    <PartnerWorkspace user={user} active="checkin" title="Check-in" subtitle="Check people in at the door, by pass or by name.">
      {error === "off" ? (
        <EmptyState icon={<UsersIcon size={20} />} title="Door check-in isn't switched on yet" />
      ) : error ? (
        <LoadErrorState title="Couldn't load your check-in dates" onRetry={load} />
      ) : !data ? (
        <PageSpinner />
      ) : data.sessions.length === 0 ? (
        <EmptyState
          icon={<UsersIcon size={20} />}
          title="Nothing to check in this week"
          subtitle={user.invitedStaff && user.platformRole === "checkin_staff" ? "When you're assigned to an event or a date, it shows here." : "Dates with confirmed bookings in the next 7 days show here."}
        />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10, maxWidth: 680 }}>
          {data.sessions.map((s) => (
            <li key={s.sessionId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "14px 16px" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{s.title}</div>
                <div style={{ fontSize: 13.5, color: colors.muted }}>{s.isToday ? "Today" : dateLabel(s.date)} · {s.time}{s.status === "cancelled" ? " · cancelled" : ""}</div>
              </div>
              {s.isToday && s.status !== "cancelled" ? (
                <RouteLinkButton to={`/vendor/door/${s.sessionId}`}>Open door mode</RouteLinkButton>
              ) : (
                <span style={{ fontSize: 13, color: colors.muted }}>Opens on the day</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </PartnerWorkspace>
  );
}

type Loaded = Awaited<ReturnType<typeof fetchDoorSession>>;

export function VendorDoorScreen() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<DoorBooking | null>(null);
  const [scanning, setScanning] = useState(false);
  const [banner, setBanner] = useState<{ tone: "ok" | "stop"; text: string } | null>(null);

  const load = useCallback(() => {
    fetchDoorSession(sessionId)
      .then((d) => {
        setData(d);
        setError(null);
        // Keep an open group in step with other devices at the same door.
        setOpen((cur) => (cur ? d.bookings.find((b) => b.ref === cur.ref) ?? cur : cur));
      })
      .catch((e) => setError({ status: e instanceof ApiError ? e.status : undefined, message: e instanceof Error ? e.message : "Couldn't load" }));
  }, [sessionId]);

  useEffect(() => {
    if (!loading && (!user || user.role !== "vendor")) navigate("/login");
    else if (user) load();
  }, [loading, user, load, navigate]);
  // Several people can work the same door: refresh every 20 seconds.
  useEffect(() => {
    const t = window.setInterval(load, 20_000);
    return () => window.clearInterval(t);
  }, [load]);

  const replace = (b: DoorBooking) => {
    setOpen(b);
    setData((d) => (d ? { ...d, bookings: d.bookings.map((x) => (x.ref === b.ref ? b : x)), counts: recount(d.bookings.map((x) => (x.ref === b.ref ? b : x))) } : d));
  };

  const lookup = async (raw: string): Promise<ScanResult> => {
    const code = readPassCode(raw);
    const ref = code && code.kind === "experience" ? code.ref : raw.trim().toUpperCase();
    try {
      const r = await doorLookup(sessionId, ref);
      setOpen(r.booking);
      setBanner(r.verdict.ok ? null : { tone: "stop", text: `${r.booking.contactName}: ${r.verdict.message}` });
      setScanning(false);
      return { ok: r.verdict.ok, message: r.verdict.ok ? `${r.booking.contactName} · ${r.booking.people.length} ${r.booking.people.length === 1 ? "person" : "people"}` : r.verdict.message };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't read that pass";
      setBanner({ tone: "stop", text: message });
      return { ok: false, message };
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data?.bookings ?? [];
    if (!q) return list;
    return list.filter((b) => b.ref.toLowerCase().includes(q) || b.contactName.toLowerCase().includes(q) || b.people.some((p) => p.name.toLowerCase().includes(q)));
  }, [data, query]);

  if (loading) return <PageSpinner />;
  if (!user || user.role !== "vendor") return null;
  if (error && !data) {
    return (
      <DoorFrame title="Door check-in">
        {error.status === 403 || error.status === 404 ? (
          <EmptyState icon={<UsersIcon size={20} />} title={error.message} subtitle="Ask the organiser to assign you to this date." />
        ) : (
          <LoadErrorState title="Couldn't load the door list" onRetry={load} />
        )}
      </DoorFrame>
    );
  }
  if (!data) return <PageSpinner />;
  const s = data.session;

  if (scanning) return <ScanPassModal open title={`Scan passes · ${s.title}`} hint="Hold the code on their pass inside the square." onClose={() => setScanning(false)} onCode={lookup} />;

  return (
    <DoorFrame title={s.title} session={s}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 30 }}>
            {data.counts.checkedIn} <span style={{ color: colors.mutedLight, fontSize: 20 }}>/ {data.counts.people}</span>
          </span>
          <span style={{ fontSize: 13, color: colors.muted, fontWeight: 700 }}>checked in · {data.counts.notArrived} to come</span>
        </div>
        <div aria-hidden="true" style={{ height: 8, borderRadius: radius.control, background: colors.panel, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${data.counts.people ? (data.counts.checkedIn / data.counts.people) * 100 : 0}%`, background: colors.green }} />
        </div>
        {!s.isToday && <p role="note" style={{ margin: 0, fontSize: 13.5, color: colors.orangeDark }}>Check-in for this date opens on {dateLabel(s.date)}.</p>}
        <Button size="lg" onClick={() => setScanning(true)} style={{ width: "100%", minHeight: 52 }}>
          <QrCode size={18} aria-hidden="true" /> Scan a pass
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (/^EX-/i.test(query.trim())) void lookup(query);
          }}
          style={{ display: "flex", alignItems: "center", gap: 8, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "12px 14px" }}
        >
          <SearchIcon size={16} style={{ color: colors.faint }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or booking reference" aria-label="Search by name or booking reference" style={{ flex: 1, border: "none", background: "none", fontSize: 16, outline: "none" }} />
        </form>
        {banner && (
          <p role="alert" style={{ margin: 0, padding: "12px 14px", borderRadius: radius.control, fontWeight: 700, fontSize: 15, background: banner.tone === "stop" ? "#fde8e4" : colors.greenBg, color: banner.tone === "stop" ? colors.dangerSolid : colors.greenText }}>
            {banner.text}
          </p>
        )}
        {open && <GroupPanel key={open.ref} sessionId={sessionId} booking={open} onChange={replace} onClose={() => { setOpen(null); setBanner(null); }} onMessage={setBanner} />}
        <h2 style={{ fontSize: 14, margin: "8px 0 0", color: colors.muted, textTransform: "uppercase", letterSpacing: 0 }}>Bookings ({shown.length})</h2>
        {shown.length === 0 ? (
          <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>{query ? "Nobody matches. Try the booking reference on their pass." : "No confirmed bookings for this date."}</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map((b) => {
              const done = b.checkedIn === b.people.length && b.people.length > 0;
              return (
                <li key={b.ref}>
                  <button
                    type="button"
                    onClick={() => { setOpen(b); setBanner(null); }}
                    aria-label={`${b.contactName}, ${b.checkedIn} of ${b.people.length} checked in`}
                    style={{ width: "100%", minHeight: 56, textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: done ? colors.greenBg : colors.surface, border: `1px solid ${open?.ref === b.ref ? colors.text : colors.border}`, borderRadius: radius.control, padding: "10px 14px", cursor: "pointer", font: "inherit", color: colors.text }}
                  >
                    <span>
                      <strong style={{ fontSize: 15 }}>{b.contactName}</strong>
                      <span style={{ display: "block", fontSize: 12.5, color: colors.muted }}>{b.ref} · {b.people.map((p) => p.name).join(", ")}</span>
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap" }}>{done ? <CheckIcon size={18} /> : null} {b.checkedIn}/{b.people.length}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DoorFrame>
  );
}

function recount(bookings: DoorBooking[]) {
  const people = bookings.reduce((n, b) => n + b.people.length, 0);
  const checkedIn = bookings.reduce((n, b) => n + b.checkedIn, 0);
  return { bookings: bookings.length, people, checkedIn, notArrived: people - checkedIn };
}

/** The door screen's own frame: a back link and the date, no workspace navigation. */
function DoorFrame({ title, session, children }: { title: string; session?: DoorSessionInfo; children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", background: colors.bg, padding: "12px 16px 40px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <Link to="/vendor/door" style={{ fontSize: 14, fontWeight: 700, color: colors.muted }}>← All check-in dates</Link>
        <header>
          <h1 style={{ fontFamily: fonts.display, fontSize: 22, margin: 0 }}>{title}</h1>
          {session && <p style={{ margin: "2px 0 0", fontSize: 14, color: colors.muted }}>{session.isToday ? "Today" : dateLabel(session.date)} · {session.time} · Door check-in</p>}
        </header>
        {children}
      </div>
    </main>
  );
}

function GroupPanel({ sessionId, booking, onChange, onClose, onMessage }: {
  sessionId: string;
  booking: DoorBooking;
  onChange: (b: DoorBooking) => void;
  onClose: () => void;
  onMessage: (m: { tone: "ok" | "stop"; text: string } | null) => void;
}) {
  const waiting = booking.people.filter((p) => !p.checkedInAt).map((p) => p.attendeeNo);
  const [picked, setPicked] = useState<number[]>(waiting);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  const admit = async () => {
    setBusy(true);
    try {
      const r = await doorCheckIn(sessionId, booking.ref, picked, "manual");
      if (r.booking) onChange(r.booking);
      const fresh = r.results.filter((x) => x.result === "checked_in").length;
      const already = r.results.filter((x) => x.result === "already");
      onMessage({ tone: "ok", text: `${fresh} checked in${already.length ? ` · ${already.length} already in` : ""}` });
      setPicked([]);
    } catch (e) {
      onMessage({ tone: "stop", text: e instanceof Error ? e.message : "Couldn't check in" });
    } finally {
      setBusy(false);
    }
  };
  const undo = async (n: number, name: string) => {
    setBusy(true);
    try {
      const r = await doorUndo(sessionId, booking.ref, n);
      onChange(r.booking);
      onMessage({ tone: "ok", text: `${name} is no longer checked in` });
    } catch (e) {
      onMessage({ tone: "stop", text: e instanceof Error ? e.message : "Couldn't undo" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section ref={ref} tabIndex={-1} aria-label={`Booking ${booking.ref}`} style={{ background: colors.surface, border: `2px solid ${booking.admit.ok ? colors.green : colors.dangerSolid}`, borderRadius: radius.card, padding: 14, outline: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{booking.contactName}</h2>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: colors.muted }}>{booking.ref} · {booking.people.length} {booking.people.length === 1 ? "person" : "people"}</p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close this booking">Close</Button>
      </div>
      <p style={{ margin: "10px 0", fontWeight: 800, fontSize: 15, color: booking.admit.ok ? colors.greenText : colors.dangerSolid }}>{booking.admit.message}</p>
      {booking.bookingAnswers.length > 0 && (
        <dl style={{ margin: "0 0 10px", fontSize: 13.5 }}>
          {booking.bookingAnswers.map((a) => <div key={a.label}><dt style={{ display: "inline", color: colors.muted }}>{answerLabel(a.label)}</dt><dd style={{ display: "inline", margin: 0 }}>{a.value}</dd></div>)}
        </dl>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {booking.people.map((p) => {
          const label = `${p.name}, ${p.personType === "child" ? "child" : "adult"}`;
          return (
            <li key={p.attendeeNo} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: radius.control, background: p.checkedInAt ? colors.greenBg : colors.bg, minHeight: 52 }}>
              {p.checkedInAt ? (
                <span style={{ fontSize: 15 }}>
                  <CheckIcon size={16} /> <strong>{p.name}</strong> <PersonFacts p={p} />
                  <span style={{ display: "block", fontSize: 12.5, color: colors.greenText }}>In at {timeOf(p.checkedInAt)}</span>
                </span>
              ) : (
                <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 15, flex: 1, cursor: booking.admit.ok ? "pointer" : "default" }}>
                  <input type="checkbox" checked={picked.includes(p.attendeeNo)} disabled={!booking.admit.ok || busy} onChange={() => toggle(p.attendeeNo)} aria-label={`Arriving now: ${label}`} style={{ width: 22, height: 22 }} />
                  <span><strong>{p.name}</strong> <PersonFacts p={p} /></span>
                </label>
              )}
              {p.checkedInAt && (
                <Button variant="ghost" disabled={busy} onClick={() => undo(p.attendeeNo, p.name)} aria-label={`Undo check-in for ${p.name}`}>Undo</Button>
              )}
            </li>
          );
        })}
      </ul>
      {booking.admit.ok && waiting.length > 0 && (
        <Button size="lg" onClick={admit} disabled={busy || picked.length === 0} aria-busy={busy} style={{ width: "100%", marginTop: 12, minHeight: 52 }}>
          {picked.length === 0 ? "Tick who is arriving" : picked.length === waiting.length ? `Check in ${picked.length === 1 ? "1 person" : `all ${picked.length}`}` : `Check in ${picked.length} of ${waiting.length}`}
        </Button>
      )}
    </section>
  );
}

function PersonFacts({ p }: { p: DoorBooking["people"][number] }) {
  const facts = [p.personType === "child" ? "Child" : null, optionNote(p.lineLabel, p.personType), p.guardianName ? `with ${p.guardianName}` : null].filter(Boolean);
  return (
    <>
      {facts.length > 0 && <span style={{ display: "block", fontSize: 12.5, color: colors.muted }}>{facts.join(" · ")}</span>}
      {p.answers.map((a) => <span key={a.label} style={{ display: "block", fontSize: 12.5, color: colors.muted }}>{answerLabel(a.label)}{a.value}</span>)}
    </>
  );
}

