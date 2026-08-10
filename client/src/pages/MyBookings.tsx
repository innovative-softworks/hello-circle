import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cancelBooking, cancelRegistration, fetchMyBookings, fetchMyRegistrations } from "../api";
import { Photo } from "../components/Photo";
import { Button, RowSkeleton } from "../components/ui";
import { dateLabel, euro } from "../euro";
import { colors, fonts } from "../theme";
import type { MyBooking, MyRegistration } from "../types";

export function MyBookings() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingRef, setCancellingRef] = useState<string | null>(null);
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([fetchMyBookings().then(setBookings), fetchMyRegistrations().then(setRegs)]).then(() => setLoading(false));
  }, []);

  const hasNone = !loading && bookings.length === 0 && regs.length === 0;

  const handleCancelBooking = async (ref: string) => {
    setCancellingRef(ref);
    setCancelErrors((e) => ({ ...e, [ref]: "" }));
    try {
      await cancelBooking(ref);
      setBookings((rows) => rows.map((r) => (r.ref === ref ? { ...r, status: "cancelled" } : r)));
    } catch (e) {
      setCancelErrors((errs) => ({ ...errs, [ref]: e instanceof Error ? e.message : "Couldn't cancel this booking" }));
    } finally {
      setCancellingRef(null);
    }
  };

  const handleCancelRegistration = async (ref: string) => {
    setCancellingRef(ref);
    setCancelErrors((e) => ({ ...e, [ref]: "" }));
    try {
      await cancelRegistration(ref);
      setRegs((rows) => rows.map((r) => (r.ref === ref ? { ...r, status: "cancelled" } : r)));
    } catch (e) {
      setCancelErrors((errs) => ({ ...errs, [ref]: e instanceof Error ? e.message : "Couldn't cancel this registration" }));
    } finally {
      setCancellingRef(null);
    }
  };

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 80px" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34, margin: "0 0 24px", letterSpacing: "-.02em" }}>
          My bookings
        </h1>
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
              {bookings.map((b) => {
                const cancelled = b.status === "cancelled";
                return (
                  <div key={b.ref} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", display: "flex", alignItems: "center", gap: 18, opacity: cancelled ? 0.6 : 1 }}>
                    <Photo src={b.image} alt={b.centreName} ph={b.ph} style={{ width: 52, height: 52, borderRadius: 12, overflow: "hidden", flex: "none" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{b.centreName}</span>
                        {cancelled && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#b00020", background: "#F6E3E3", borderRadius: 999, padding: "2px 8px" }}>
                            Cancelled
                          </span>
                        )}
                      </div>
                      <div style={{ color: colors.mutedLight, fontSize: 14 }}>
                        {dateLabel(b.date)} · {b.time}
                      </div>
                      {cancelErrors[b.ref] && <div style={{ color: "#b00020", fontSize: 12, marginTop: 4 }}>{cancelErrors[b.ref]}</div>}
                    </div>
                    <div style={{ textAlign: "right", flex: "none" }}>
                      <div style={{ fontWeight: 700 }}>{euro(b.totalCents / 100)}</div>
                      <div style={{ fontSize: 12, color: colors.faint, marginBottom: cancelled ? 0 : 8 }}>{b.ref}</div>
                      {!cancelled && (
                        <Button variant="danger" onClick={() => handleCancelBooking(b.ref)} disabled={cancellingRef === b.ref}>
                          {cancellingRef === b.ref ? "Cancelling…" : "Cancel"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {regs.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>
              CLUB REGISTRATIONS
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {regs.map((r) => {
                const cancelled = r.status === "cancelled";
                return (
                  <div key={r.ref} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", display: "flex", alignItems: "center", gap: 18, opacity: cancelled ? 0.6 : 1 }}>
                    <div
                      style={{ width: 52, height: 52, borderRadius: 12, background: colors.orangeBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.orangeDark, fontWeight: 700, fontSize: 12 }}
                    >
                      {r.sport}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{`${r.childFirst} ${r.childLast}`.trim()}</span>
                        {cancelled && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#b00020", background: "#F6E3E3", borderRadius: 999, padding: "2px 8px" }}>
                            Cancelled
                          </span>
                        )}
                      </div>
                      <div style={{ color: colors.mutedLight, fontSize: 14 }}>
                        {r.clubName} · {r.team}
                      </div>
                      {cancelErrors[r.ref] && <div style={{ color: "#b00020", fontSize: 12, marginTop: 4 }}>{cancelErrors[r.ref]}</div>}
                    </div>
                    <div style={{ textAlign: "right", flex: "none" }}>
                      <div style={{ fontWeight: 700 }}>{r.trial ? "Free trial" : euro(r.totalCents / 100)}</div>
                      <div style={{ fontSize: 12, color: colors.faint, marginBottom: cancelled ? 0 : 8 }}>{r.ref}</div>
                      {!cancelled && (
                        <Button variant="danger" onClick={() => handleCancelRegistration(r.ref)} disabled={cancellingRef === r.ref}>
                          {cancellingRef === r.ref ? "Cancelling…" : "Cancel"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
