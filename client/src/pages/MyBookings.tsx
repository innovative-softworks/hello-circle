import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyBookings, fetchMyRegistrations } from "../api";
import { Photo } from "../components/Photo";
import { RowSkeleton } from "../components/ui";
import { dateLabel, euro } from "../euro";
import { colors, fonts } from "../theme";
import type { MyBooking, MyRegistration } from "../types";

export function MyBookings() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchMyBookings().then(setBookings), fetchMyRegistrations().then(setRegs)]).then(() => setLoading(false));
  }, []);

  const hasNone = !loading && bookings.length === 0 && regs.length === 0;

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
              {bookings.map((b) => (
                <div key={b.ref} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", display: "flex", alignItems: "center", gap: 18 }}>
                  <Photo src={b.image} alt={b.centreName} ph={b.ph} style={{ width: 52, height: 52, borderRadius: 12, overflow: "hidden", flex: "none" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{b.centreName}</div>
                    <div style={{ color: colors.mutedLight, fontSize: 14 }}>
                      {dateLabel(b.date)} · {b.time}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{euro(b.totalCents / 100)}</div>
                    <div style={{ fontSize: 12, color: colors.faint }}>{b.ref}</div>
                  </div>
                </div>
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
                <div key={r.ref} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", display: "flex", alignItems: "center", gap: 18 }}>
                  <div
                    style={{ width: 52, height: 52, borderRadius: 12, background: colors.orangeBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.orangeDark, fontWeight: 700, fontSize: 12 }}
                  >
                    {r.sport}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{`${r.childFirst} ${r.childLast}`.trim()}</div>
                    <div style={{ color: colors.mutedLight, fontSize: 14 }}>
                      {r.clubName} · {r.team}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{r.trial ? "Free trial" : euro(r.totalCents / 100)}</div>
                    <div style={{ fontSize: 12, color: colors.faint }}>{r.ref}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
