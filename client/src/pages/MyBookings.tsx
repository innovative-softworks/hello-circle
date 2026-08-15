import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cancelBooking, cancelRegistration, fetchMyBookings, fetchMyRegistrations, lookupBooking, lookupRegistration } from "../api";
import { ChevronRightIcon } from "../components/icons";
import { Photo } from "../components/Photo";
import { Button, RowSkeleton, inputStyle, labelStyle } from "../components/ui";
import { dateLabel, euro } from "../euro";
import { colors, fonts } from "../theme";
import type { MyBooking, MyRegistration } from "../types";

const cancelledBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#b00020", background: "#F6E3E3", borderRadius: 999, padding: "2px 8px" };
const recoveredBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 8px" };

function BookingRow({
  booking,
  onCancel,
  cancelling,
  error,
  recovered,
}: {
  booking: MyBooking;
  onCancel: () => void;
  cancelling: boolean;
  error?: string;
  recovered?: boolean;
}) {
  const cancelled = booking.status === "cancelled";
  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", display: "flex", alignItems: "center", gap: 18, opacity: cancelled ? 0.6 : 1 }}>
      <Photo src={booking.image} alt={booking.centreName} ph={booking.ph} style={{ width: 52, height: 52, borderRadius: 12, overflow: "hidden", flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{booking.centreName}</span>
          {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
          {recovered && <span style={recoveredBadgeStyle}>Found by reference</span>}
        </div>
        <div style={{ color: colors.mutedLight, fontSize: 14 }}>
          {dateLabel(booking.date)} · {booking.time}
        </div>
        {error && <div style={{ color: "#b00020", fontSize: 12, marginTop: 4 }}>{error}</div>}
      </div>
      <div style={{ textAlign: "right", flex: "none" }}>
        <div style={{ fontWeight: 700 }}>{euro(booking.totalCents / 100)}</div>
        <div style={{ fontSize: 12, color: colors.faint, marginBottom: cancelled ? 0 : 8 }}>{booking.ref}</div>
        {!cancelled && (
          <Button variant="danger" onClick={onCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>
    </div>
  );
}

function RegistrationRow({
  registration,
  onCancel,
  cancelling,
  error,
  recovered,
}: {
  registration: MyRegistration;
  onCancel: () => void;
  cancelling: boolean;
  error?: string;
  recovered?: boolean;
}) {
  const cancelled = registration.status === "cancelled";
  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", display: "flex", alignItems: "center", gap: 18, opacity: cancelled ? 0.6 : 1 }}>
      <div style={{ width: 52, height: 52, borderRadius: 12, background: colors.orangeBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.orangeDark, fontWeight: 700, fontSize: 12 }}>
        {registration.sport}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{`${registration.childFirst} ${registration.childLast}`.trim()}</span>
          {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
          {recovered && <span style={recoveredBadgeStyle}>Found by reference</span>}
        </div>
        <div style={{ color: colors.mutedLight, fontSize: 14 }}>
          {registration.clubName} · {registration.team}
        </div>
        {error && <div style={{ color: "#b00020", fontSize: 12, marginTop: 4 }}>{error}</div>}
      </div>
      <div style={{ textAlign: "right", flex: "none" }}>
        <div style={{ fontWeight: 700 }}>{registration.trial ? "Free trial" : euro(registration.totalCents / 100)}</div>
        <div style={{ fontSize: 12, color: colors.faint, marginBottom: cancelled ? 0 : 8 }}>{registration.ref}</div>
        {!cancelled && (
          <Button variant="danger" onClick={onCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>
    </div>
  );
}

type LookupResult = { kind: "booking"; data: MyBooking } | { kind: "registration"; data: MyRegistration };

export function MyBookings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingRef, setCancellingRef] = useState<string | null>(null);
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});

  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupRef, setLookupRef] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  useEffect(() => {
    Promise.all([fetchMyBookings().then(setBookings), fetchMyRegistrations().then(setRegs)]).then(() => setLoading(false));
  }, []);

  // A confirmation email links back to /bookings?ref=... (see server/src/notifications.ts)
  // for exactly this recovery flow — pre-fill and open the form on arrival.
  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) {
      setLookupRef(ref);
      setLookupOpen(true);
    }
  }, [searchParams]);

  const hasNone = !loading && bookings.length === 0 && regs.length === 0;

  const handleCancelBooking = async (ref: string, email?: string) => {
    setCancellingRef(ref);
    setCancelErrors((e) => ({ ...e, [ref]: "" }));
    try {
      await cancelBooking(ref, email);
      setBookings((rows) => rows.map((r) => (r.ref === ref ? { ...r, status: "cancelled" } : r)));
      setLookupResult((res) => (res && res.kind === "booking" && res.data.ref === ref ? { ...res, data: { ...res.data, status: "cancelled" } } : res));
    } catch (e) {
      setCancelErrors((errs) => ({ ...errs, [ref]: e instanceof Error ? e.message : "Couldn't cancel this booking" }));
    } finally {
      setCancellingRef(null);
    }
  };

  const handleCancelRegistration = async (ref: string, email?: string) => {
    setCancellingRef(ref);
    setCancelErrors((e) => ({ ...e, [ref]: "" }));
    try {
      await cancelRegistration(ref, email);
      setRegs((rows) => rows.map((r) => (r.ref === ref ? { ...r, status: "cancelled" } : r)));
      setLookupResult((res) => (res && res.kind === "registration" && res.data.ref === ref ? { ...res, data: { ...res.data, status: "cancelled" } } : res));
    } catch (e) {
      setCancelErrors((errs) => ({ ...errs, [ref]: e instanceof Error ? e.message : "Couldn't cancel this registration" }));
    } finally {
      setCancellingRef(null);
    }
  };

  const handleLookup = async () => {
    const ref = lookupRef.trim();
    const email = lookupEmail.trim();
    if (!ref || !email) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      if (ref.toUpperCase().startsWith("CR-")) {
        setLookupResult({ kind: "registration", data: await lookupRegistration(ref, email) });
      } else {
        setLookupResult({ kind: "booking", data: await lookupBooking(ref, email) });
      }
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "Couldn't find that booking");
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 80px" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34, margin: "0 0 24px", letterSpacing: "-.02em" }}>
          My bookings
        </h1>

        <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 28 }}>
          <button
            onClick={() => setLookupOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 15, fontWeight: 700, color: colors.text }}
          >
            Booked on another device? Find it by reference + email
            <ChevronRightIcon size={16} style={{ transform: lookupOpen ? "rotate(90deg)" : "none", transition: "transform .15s ease", flex: "none" }} />
          </button>
          {lookupOpen && (
            <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 160px" }}>
                <label style={labelStyle}>Reference</label>
                <input value={lookupRef} onChange={(e) => setLookupRef(e.target.value)} placeholder="HB-123456" style={inputStyle} />
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label style={labelStyle}>Email</label>
                <input value={lookupEmail} onChange={(e) => setLookupEmail(e.target.value)} placeholder="you@email.ie" style={inputStyle} />
              </div>
              <Button onClick={handleLookup} disabled={lookupLoading || !lookupRef.trim() || !lookupEmail.trim()}>
                {lookupLoading ? "Searching…" : "Find"}
              </Button>
            </div>
          )}
          {lookupError && <div style={{ color: "#b00020", fontSize: 13, marginTop: 10 }}>{lookupError}</div>}
        </div>

        {lookupResult && (
          <div style={{ marginBottom: 32 }}>
            {lookupResult.kind === "booking" ? (
              <BookingRow
                booking={lookupResult.data}
                onCancel={() => handleCancelBooking(lookupResult.data.ref, lookupEmail.trim())}
                cancelling={cancellingRef === lookupResult.data.ref}
                error={cancelErrors[lookupResult.data.ref]}
                recovered
              />
            ) : (
              <RegistrationRow
                registration={lookupResult.data}
                onCancel={() => handleCancelRegistration(lookupResult.data.ref, lookupEmail.trim())}
                cancelling={cancellingRef === lookupResult.data.ref}
                error={cancelErrors[lookupResult.data.ref]}
                recovered
              />
            )}
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: 3 }, (_, i) => <RowSkeleton key={i} />)}
          </div>
        )}
        {hasNone && (
          <div style={{ background: "#fff", border: "1px dashed " + colors.borderStrong, borderRadius: 18, padding: 48, textAlign: "center" }}>
            <p style={{ color: colors.mutedLight, fontSize: 16, margin: "0 0 18px" }}>
              Nothing booked yet. Find a hall or a club to get started.
            </p>
            <button
              onClick={() => navigate("/")}
              style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "12px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
            >
              Explore Hello Circle
            </button>
          </div>
        )}
        {bookings.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>
              HALL BOOKINGS
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {bookings.map((b) => (
                <BookingRow
                  key={b.ref}
                  booking={b}
                  onCancel={() => handleCancelBooking(b.ref)}
                  cancelling={cancellingRef === b.ref}
                  error={cancelErrors[b.ref]}
                />
              ))}
            </div>
          </>
        )}
        {regs.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>
              CLUB REGISTRATIONS
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {regs.map((r) => (
                <RegistrationRow
                  key={r.ref}
                  registration={r}
                  onCancel={() => handleCancelRegistration(r.ref)}
                  cancelling={cancellingRef === r.ref}
                  error={cancelErrors[r.ref]}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
