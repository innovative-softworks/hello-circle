import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchBookingChange, respondToBookingChange, type BookingChangeView } from "../api";
import { dateLabel } from "../euro";
import { Button, ManageCard as Card, LoadErrorState, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts } from "../theme";

// OG-11 / DEC-17 — the page the venue's "we'd like to move your booking"
// email links to. Accepting moves the booking (same booking, same payment);
// declining leaves it exactly as it was.

export function BookingChangePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [view, setView] = useState<BookingChangeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: string; date: string; time: string } | null>(null);

  const load = () => {
    setLoadError(null);
    fetchBookingChange(token)
      .then(setView)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "This link isn't valid"));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  const answer = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setDone(await respondToBookingChange(token, accept, note.trim() || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <div style={{ maxWidth: 560, margin: "48px auto", padding: "0 16px" }}><LoadErrorState title="We couldn't open this change" detail={loadError} onRetry={load} /></div>;
  if (!view) return <PageSpinner />;

  const open = view.status === "proposed" && !view.bookingCancelled;
  return (
    <div style={{ maxWidth: 560, margin: "48px auto", padding: "0 16px" }}>
      <Card style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ fontFamily: fonts.display, fontSize: 26, margin: 0 }}>{view.venue} would like to move your booking</h1>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12.5, color: colors.mutedLight, fontWeight: 700 }}>NOW</div>
            <div style={{ fontWeight: 700, fontSize: 17, textDecoration: done?.status === "accepted" ? "line-through" : undefined }}>
              {dateLabel(view.from.date)} · {view.from.time}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, color: colors.mutedLight, fontWeight: 700 }}>PROPOSED</div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>
              {dateLabel(view.to.date)} · {view.to.time}
            </div>
          </div>
        </div>
        {view.message && (
          <p style={{ margin: 0, background: colors.panel, padding: "10px 14px" }}>
            <strong>Their message:</strong> {view.message}
          </p>
        )}
        <p style={{ margin: 0, fontSize: 13.5, color: colors.mutedLight }}>Booking {view.ref}. Nothing about your payment changes.</p>

        {done ? (
          <p role="status" style={{ margin: 0, fontWeight: 700, color: colors.greenText }}>
            {done.status === "accepted" ? `Done — your booking is now ${dateLabel(done.date)} at ${done.time}.` : "Thanks — your booking stays as it was. The venue has been told."}
          </p>
        ) : open ? (
          <>
            <label htmlFor="change-note" style={labelStyle}>
              Note to the venue (optional)
            </label>
            <textarea id="change-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
            {error && (
              <p role="alert" style={{ margin: 0, color: colors.danger }}>
                {error}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button onClick={() => answer(true)} disabled={busy}>
                Accept the new time
              </Button>
              <Button variant="ghost" onClick={() => answer(false)} disabled={busy}>
                Keep my original time
              </Button>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: colors.mutedLight }}>If you keep the original time, the venue may still need to cancel. If they do, a booking you paid for online is refunded in full.</p>
          </>
        ) : (
          <p role="status" style={{ margin: 0, fontWeight: 600 }}>
            {view.bookingCancelled
              ? "This booking has been cancelled."
              : view.status === "accepted"
                ? "You've already accepted this change."
                : view.status === "declined"
                  ? "You've kept your original time."
                  : view.status === "expired"
                    ? "This change has expired. Your booking stays as it was."
                    : "The venue has withdrawn this change. Your booking stays as it was."}
          </p>
        )}
      </Card>
    </div>
  );
}
