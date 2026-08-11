import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createBookingCheckout, fetchAvailability, fetchAvailabilityRange, fetchCentre, validateCoupon, PLATFORM_FEE_RATE, VAT_RATE } from "../api";
import { Chip } from "../components/Chip";
import { Photo } from "../components/Photo";
import { Stepper } from "../components/Stepper";
import { PageSpinner } from "../components/ui";
import { DURATION_OPTIONS, EVENT_TYPES, TIME_SLOTS } from "../constants";
import { dateLabel, euro } from "../euro";
import { ChevronLeftIcon, ChevronRightIcon, CheckIcon, CloseIcon } from "../components/icons";
import { colors, fonts } from "../theme";
import type { Centre, Room } from "../types";
import { isValidEmail } from "../validate";

interface BookingForm {
  date: string | null;
  time: string | null;
  duration: number;
  eventType: string;
  guests: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
}

function blankForm(): BookingForm {
  return { date: null, time: null, duration: 3, eventType: "", guests: "", name: "", email: "", phone: "", notes: "" };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEPOSIT_EURO = 100;

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Mon-first-of-month grid (Sun-start weeks), padded with nulls for days outside the month. */
function monthGrid(year: number, month: number): (Date | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 12,
  fontSize: 15,
  background: "#fff",
  color: colors.text,
  outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: colors.muted, margin: "0 0 6px" };

export function BookingFlow() {
  const { centreId } = useParams<{ centreId: string }>();
  const navigate = useNavigate();
  const [centre, setCentre] = useState<Centre | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<BookingForm>(blankForm());
  const [bookedTimes, setBookedTimes] = useState<string[]>([]);
  const [daySlots, setDaySlots] = useState<string[]>(TIME_SLOTS);
  const [dayClosed, setDayClosed] = useState(false);
  const [closedDates, setClosedDates] = useState<Set<string>>(new Set());
  const [monthOffset, setMonthOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedRef, setConfirmedRef] = useState<string | null>(null);

  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  useEffect(() => {
    if (centreId) fetchCentre(centreId).then(setCentre);
  }, [centreId]);

  // A centre has exactly one (internal, never user-picked) room — resolve it
  // here once the centre loads.
  const room: Room | undefined = centre?.rooms[0];
  const roomId = room?.id;
  const isCash = room?.paymentMethod === "cash";

  useEffect(() => {
    if (roomId) fetchAvailabilityRange(roomId, toIso(new Date()), 62).then((r) => setClosedDates(new Set(r.closedDates)));
  }, [roomId]);

  useEffect(() => {
    if (roomId && form.date) {
      fetchAvailability(roomId, form.date, form.duration).then((r) => {
        setBookedTimes(r.bookedTimes);
        setDaySlots(r.slots);
        setDayClosed(r.closed);
        // A duration change can invalidate an already-picked start time
        // (it now overlaps another booking) — clear it so the user re-picks
        // rather than silently proceeding toward a checkout that will fail.
        setForm((f) => (f.time && r.bookedTimes.includes(f.time) ? { ...f, time: null } : f));
      });
    }
  }, [roomId, form.date, form.duration]);

  // Venues are in Ireland, so "today" should be Ireland's calendar date even
  // if a guest happens to be browsing from a different timezone — not the
  // browser's own local date. Constructing a local Date from Ireland's Y/M/D
  // means every downstream calendar calculation (which uses local getters
  // like getMonth/getDate) keeps working unchanged.
  const today = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return new Date(get("year"), get("month") - 1, get("day"));
  }, []);
  const minSelectable = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [today]);
  const maxSelectable = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 60);
    return d;
  }, [today]);
  const viewDate = useMemo(() => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1), [today, monthOffset]);
  const weeks = useMemo(() => monthGrid(viewDate.getFullYear(), viewDate.getMonth()), [viewDate]);

  const hireCents = room ? (form.duration >= 8 ? Math.round(room.rate * 6.5) : room.rate * form.duration) * 100 : 0;
  const discountCents = coupon?.discountCents ?? 0;
  const taxableCents = Math.max(0, hireCents - discountCents);
  const vatCents = Math.round(taxableCents * VAT_RATE);
  const feeCents = Math.round(taxableCents * PLATFORM_FEE_RATE);
  const depositCents = isCash ? 0 : DEPOSIT_EURO * 100;
  const totalCents = taxableCents + vatCents + feeCents + depositCents;

  const b1Ready = !!(form.date && form.time && form.duration);
  const b2Ready = !!(form.eventType && form.guests && form.name && form.email && isValidEmail(form.email) && form.phone);
  const ready = step === 1 ? b1Ready : step === 2 ? b2Ready : true;

  const set = <K extends keyof BookingForm>(field: K, value: BookingForm[K]) =>
    setForm((f) => ({ ...f, [field]: value }));

  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const applyCoupon = async () => {
    if (!couponInput.trim()) return;
    setCouponChecking(true);
    setCouponError(null);
    try {
      const res = await validateCoupon(couponInput.trim(), hireCents);
      setCoupon({ code: res.code, discountCents: res.discountCents });
    } catch (e) {
      setCoupon(null);
      setCouponError(e instanceof Error ? e.message : "Couldn't apply that code");
    } finally {
      setCouponChecking(false);
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponInput("");
    setCouponError(null);
  };

  const submit = async () => {
    if (!centreId || !roomId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await createBookingCheckout({
        centreId,
        roomId,
        date: form.date!,
        time: form.time!,
        duration: form.duration,
        eventType: form.eventType,
        guests: Number(form.guests),
        name: form.name,
        email: form.email,
        phone: form.phone,
        notes: form.notes,
        couponCode: coupon?.code,
      });
      if (res.url) {
        window.location.href = res.url;
      } else {
        // Cash room — confirmed immediately, no Stripe redirect.
        setConfirmedRef(res.ref);
        setSubmitting(false);
        top();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setSubmitting(false);
    }
  };

  const next = () => {
    if (!ready) return;
    if (step < 3) {
      setStep(step + 1);
      top();
    } else {
      submit();
    }
  };
  const prev = () => {
    if (step > 1) {
      setStep(step - 1);
      top();
    }
  };
  const back = () => {
    if (step > 1) prev();
    else navigate(`/centres/${centreId}`);
  };

  if (!centre || !room) return <PageSpinner />;

  if (confirmedRef) {
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "56px 24px 80px", textAlign: "center" }}>
          <div style={{ width: 74, height: 74, borderRadius: "50%", background: colors.greenBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", fontSize: 34, color: colors.green }}>
            <CheckIcon size={32} />
          </div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34, margin: "0 0 8px", letterSpacing: "-.02em" }}>
            Booking confirmed!
          </h1>
          <p style={{ color: colors.muted, fontSize: 17, margin: "0 0 28px" }}>
            Pay {euro(totalCents / 100)} in cash at the venue — no online payment needed. We've emailed {form.email || "you"} the details.
          </p>
          <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 24, textAlign: "left", marginBottom: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 2 }}>{centre.name}</div>
            <div style={{ color: colors.mutedLight, fontSize: 14, marginBottom: 16 }}>{dateLabel(form.date)} at {form.time}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>REFERENCE</div>
                <div style={{ fontWeight: 600 }}>{confirmedRef}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>PAYMENT</div>
                <div style={{ fontWeight: 600 }}>Cash on arrival</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => navigate("/bookings")} style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              View my bookings
            </button>
            <button onClick={() => navigate("/")} style={{ background: "#fff", color: colors.text, border: `1px solid ${colors.borderStrong}`, borderRadius: 12, padding: "13px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
              Back home
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 920, margin: "0 auto", padding: "26px 24px 80px" }}>
        <button onClick={back} style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", color: colors.muted, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 20 }}>
          <ChevronLeftIcon size={14} style={{ marginRight: 4 }} /> {step > 1 ? "Back a step" : "Back to centre"}
        </button>
        <Stepper labels={["Date & time", "Event details", "Review & pay"]} current={step} accent="green" />

        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 32, alignItems: "start" }}>
          <div style={{ minWidth: 0, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 28 }}>
            {step === 1 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 18px", letterSpacing: "-.01em" }}>
                  Pick a date & time
                </h2>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colors.muted }}>DATE (next 2 months)</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                      onClick={() => setMonthOffset((m) => Math.max(0, m - 1))}
                      disabled={monthOffset === 0}
                      aria-label="Previous month"
                      style={{ background: "none", border: "none", cursor: monthOffset === 0 ? "default" : "pointer", opacity: monthOffset === 0 ? 0.3 : 1, display: "flex", color: colors.text }}
                    >
                      <ChevronLeftIcon size={16} />
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 700, minWidth: 118, textAlign: "center" }}>
                      {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
                    </span>
                    <button
                      onClick={() => setMonthOffset((m) => Math.min(1, m + 1))}
                      disabled={monthOffset === 1}
                      aria-label="Next month"
                      style={{ background: "none", border: "none", cursor: monthOffset === 1 ? "default" : "pointer", opacity: monthOffset === 1 ? 0.3 : 1, display: "flex", color: colors.text }}
                    >
                      <ChevronRightIcon size={16} />
                    </button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, marginBottom: 8 }}>
                  {DOW_LABELS.map((dow) => (
                    <div key={dow} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: colors.faint }}>
                      {dow}
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, marginBottom: 22 }}>
                  {weeks.map((d, i) => {
                    if (!d) return <div key={i} />;
                    const iso = toIso(d);
                    const active = form.date === iso;
                    const disabled = d < minSelectable || d > maxSelectable || closedDates.has(iso);
                    return (
                      <button
                        key={i}
                        disabled={disabled}
                        onClick={() => {
                          set("date", iso);
                          set("time", null);
                        }}
                        title={closedDates.has(iso) ? "Closed" : undefined}
                        style={{
                          aspectRatio: "1",
                          border: `1.5px solid ${active ? colors.green : disabled ? "transparent" : "#E2DFD6"}`,
                          background: active ? colors.green : disabled ? "#F4F2EC" : "#fff",
                          color: active ? "#fff" : disabled ? "#C2C6BE" : colors.text,
                          borderRadius: 10,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: disabled ? "not-allowed" : "pointer",
                          textDecoration: closedDates.has(iso) ? "line-through" : "none",
                        }}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>
                {form.date && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: colors.muted, marginBottom: 10 }}>START TIME</div>
                    {dayClosed ? (
                      <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 22px" }}>
                        The venue is closed on this date — pick another day.
                      </p>
                    ) : (
                      <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 22 }}>
                        {daySlots.map((t) => {
                          const booked = bookedTimes.includes(t);
                          const active = form.time === t;
                          return (
                            <button
                              key={t}
                              disabled={booked}
                              onClick={() => set("time", t)}
                              style={{
                                border: `1.5px solid ${booked ? "#EAE7DF" : active ? colors.green : "#E2DFD6"}`,
                                background: booked ? "#F4F2EC" : active ? colors.green : "#fff",
                                color: booked ? "#C2C6BE" : active ? "#fff" : colors.text,
                                borderRadius: 11, padding: "11px 0", fontSize: 14, fontWeight: 600,
                                cursor: booked ? "not-allowed" : "pointer",
                                textDecoration: booked ? "line-through" : "none",
                              }}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ fontSize: 13, fontWeight: 600, color: colors.muted, marginBottom: 10 }}>DURATION</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {DURATION_OPTIONS.map((o) => (
                        <Chip key={o.hours} label={o.label} active={form.duration === o.hours} onClick={() => set("duration", o.hours)} radius={11} padding="10px 18px" />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 18px", letterSpacing: "-.01em" }}>
                  Event details
                </h2>
                <div style={{ fontSize: 13, fontWeight: 600, color: colors.muted, marginBottom: 10 }}>TYPE OF EVENT</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
                  {EVENT_TYPES.map((e) => (
                    <Chip key={e} label={e} active={form.eventType === e} onClick={() => set("eventType", e)} />
                  ))}
                </div>
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Expected guests</label>
                    <input type="number" value={form.guests} onChange={(e) => set("guests", e.target.value)} placeholder="e.g. 40" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Full name</label>
                    <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@email.ie" style={inputStyle} />
                    {form.email && !isValidEmail(form.email) && (
                      <p style={{ color: "#b00020", fontSize: 12, margin: "6px 0 0" }}>Enter a valid email address</p>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Phone</label>
                    <input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="08X XXX XXXX" style={inputStyle} />
                  </div>
                </div>
                <label style={{ ...labelStyle, margin: "16px 0 6px" }}>Anything the centre should know? (optional)</label>
                <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Setup needs, catering, accessibility…" style={{ ...inputStyle, resize: "vertical" }} />
              </>
            )}

            {step === 3 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 6px", letterSpacing: "-.01em" }}>Review & pay</h2>
                <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 20px" }}>
                  {isCash
                    ? "This room is pay-on-arrival — no online payment needed. Your booking is confirmed as soon as you submit."
                    : "You'll pay securely on the next screen. The €100 deposit is refunded within 5 days after your event."}
                </p>

                <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 14, padding: 18, marginBottom: 18 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{centre.name}</div>
                  <div style={{ fontSize: 14, color: colors.muted, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div>{dateLabel(form.date)} at {form.time} · {DURATION_OPTIONS.find((d) => d.hours === form.duration)?.label}</div>
                    <div>{form.eventType} · {form.guests} guests</div>
                    <div>{form.name} · {form.email} · {form.phone}</div>
                  </div>
                </div>

                <label style={labelStyle}>Coupon code</label>
                {coupon ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: 12, padding: "10px 14px", marginBottom: 18 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: colors.greenText, fontWeight: 700, fontSize: 14 }}>
                      <CheckIcon size={15} /> {coupon.code} applied — €{(coupon.discountCents / 100).toFixed(2)} off
                    </span>
                    <button onClick={removeCoupon} aria-label="Remove coupon" style={{ background: "none", border: "none", cursor: "pointer", color: colors.greenText, display: "flex" }}>
                      <CloseIcon size={15} />
                    </button>
                  </div>
                ) : (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                        placeholder="e.g. WELCOME10"
                        style={{ ...inputStyle, textTransform: "uppercase" }}
                      />
                      <button
                        onClick={applyCoupon}
                        disabled={couponChecking || !couponInput.trim()}
                        style={{ flex: "none", background: colors.dark, color: "#fff", border: "none", borderRadius: 12, padding: "0 20px", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: couponChecking ? 0.6 : 1 }}
                      >
                        {couponChecking ? "Checking…" : "Apply"}
                      </button>
                    </div>
                    {couponError && <p style={{ color: "#b00020", fontSize: 13, margin: "8px 0 0" }}>{couponError}</p>}
                  </div>
                )}
              </>
            )}

            {error && <p style={{ color: "#b00020", fontSize: 14, marginTop: 16 }}>{error}</p>}

            <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
              {step > 1 && (
                <button onClick={prev} style={{ background: "#fff", color: colors.text, border: `1px solid ${colors.borderStrong}`, borderRadius: 12, padding: "13px 20px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
                  Back
                </button>
              )}
              <button
                onClick={next}
                disabled={submitting}
                style={{
                  flex: 1, background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "13px 20px",
                  fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: ready && !submitting ? 1 : 0.45, pointerEvents: ready && !submitting ? "auto" : "none",
                }}
              >
                {step === 3
                  ? submitting
                    ? isCash ? "Confirming…" : "Redirecting to secure payment…"
                    : isCash
                      ? `Confirm booking — pay ${euro(totalCents / 100)} on arrival`
                      : `Continue to pay ${euro(totalCents / 100)}`
                  : "Continue"}
              </button>
            </div>
          </div>

          <div className="sticky-aside" style={{ position: "sticky", top: 90, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 22 }}>
            <Photo src={centre.image} alt={centre.name} ph={centre.ph} style={{ height: 90, borderRadius: 12, overflow: "hidden", marginBottom: 14 }} />
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 2 }}>{centre.name}</div>
            <div style={{ color: colors.mutedLight, fontSize: 14, marginBottom: 16 }}>{centre.area}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.mutedLight }}>Date</span>
                <span style={{ fontWeight: 600 }}>{dateLabel(form.date)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.mutedLight }}>Time</span>
                <span style={{ fontWeight: 600 }}>{form.time ?? "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.mutedLight }}>Duration</span>
                <span style={{ fontWeight: 600 }}>{DURATION_OPTIONS.find((d) => d.hours === form.duration)?.label ?? "—"}</span>
              </div>
            </div>
            <div style={{ borderTop: "1px solid #EEEBE3", margin: "16px 0", paddingTop: 14, display: "flex", flexDirection: "column", gap: 9, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.mutedLight }}>Hall hire</span>
                <span style={{ fontWeight: 600 }}>{euro(hireCents / 100)}</span>
              </div>
              {discountCents > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: colors.greenText }}>
                  <span>Coupon ({coupon?.code})</span>
                  <span style={{ fontWeight: 600 }}>-{euro(discountCents / 100)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.mutedLight }}>VAT (23%)</span>
                <span style={{ fontWeight: 600 }}>{euro(vatCents / 100)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.mutedLight }}>Platform fee (5%)</span>
                <span style={{ fontWeight: 600 }}>{euro(feeCents / 100)}</span>
              </div>
              {!isCash && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: colors.mutedLight }}>Refundable deposit</span>
                  <span style={{ fontWeight: 600 }}>{euro(DEPOSIT_EURO)}</span>
                </div>
              )}
              {isCash && (
                <div style={{ display: "flex", justifyContent: "space-between", color: colors.greenText }}>
                  <span>Payment</span>
                  <span style={{ fontWeight: 600 }}>Cash on arrival</span>
                </div>
              )}
            </div>
            <div style={{ borderTop: "1px solid #EEEBE3", paddingTop: 14, display: "flex", justifyContent: "space-between", fontFamily: fonts.display, fontWeight: 700, fontSize: 19 }}>
              <span>Total</span>
              <span>{euro(totalCents / 100)}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
