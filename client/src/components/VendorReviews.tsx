import { useEffect, useState } from "react";
import { fetchVendorReviews, replyToVendorReview } from "../api";
import type { VendorReview } from "../api";
import { StarIcon } from "./icons";
import { Button, ManageCard as Card, EmptyState, PageSpinner, inputStyle } from "./ui";
import { colors, fonts, radius } from "../theme";

// Host Manage spec §16 — a vendor-facing reviews tab didn't exist at all;
// reviews.ts only ever supported guest post + admin hide/unhide. Added as a
// new top-level VendorDashboard tab rather than nested under a "More"
// submenu — no such submenu exists in this dashboard's flat-tab pattern
// today, and building one is unrelated scope.
function ReplyBox({ review, onReplied }: { review: VendorReview; onReplied: (id: number, reply: string) => void }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await replyToVendorReview(review.id, text.trim());
      onReplied(review.id, text.trim());
      setReplying(false);
    } catch {
      setError("You don't have permission to reply — this needs the communications role.");
    } finally {
      setBusy(false);
    }
  };

  if (review.vendorReply) {
    return (
      <div style={{ marginTop: 10, background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, marginBottom: 4 }}>YOUR REPLY</div>
        <div style={{ fontSize: 13.5 }}>{review.vendorReply}</div>
      </div>
    );
  }

  if (!replying) {
    return (
      <Button variant="ghost" style={{ marginTop: 10, padding: "6px 12px", fontSize: 12 }} onClick={() => setReplying(true)}>
        Reply
      </Button>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} placeholder="Write a public reply…" />
      {error && <p style={{ color: colors.danger, fontSize: 12.5, marginBottom: 8 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={submit} disabled={busy || !text.trim()}>{busy ? "Posting…" : "Post reply"}</Button>
        <Button variant="ghost" onClick={() => setReplying(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export function VendorReviewsTab() {
  const [reviews, setReviews] = useState<VendorReview[] | null>(null);

  useEffect(() => {
    fetchVendorReviews().then(setReviews);
  }, []);

  const markReplied = (id: number, reply: string) => {
    setReviews((prev) => prev && prev.map((r) => (r.id === id ? { ...r, vendorReply: reply, vendorRepliedAt: new Date().toISOString() } : r)));
  };

  if (reviews === null) return <PageSpinner />;
  if (reviews.length === 0) return <EmptyState icon={<StarIcon size={26} />} title="No reviews yet" />;

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {reviews.map((r) => (
        <Card key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5 }}>{r.name}</span>
                <span style={{ display: "flex", gap: 1 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <StarIcon key={i} size={12} filled={i < r.rating} style={{ color: i < r.rating ? colors.orange : colors.faint }} />
                  ))}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: colors.mutedLight }}>{r.listingName}</div>
            </div>
          </div>
          <p style={{ fontSize: 13.5, margin: "10px 0 0", lineHeight: 1.5 }}>{r.comment}</p>
          <ReplyBox review={r} onReplied={markReplied} />
        </Card>
      ))}
    </div>
  );
}
