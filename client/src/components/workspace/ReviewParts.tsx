import { useState } from "react";
import { MessageSquareReply, Star } from "lucide-react";
import { AdminButton, AdminModal, Box, FormField, IconTabs } from "../admin/adminUi";
import { EmptyState, StatTile } from "../ui";
import { useUrlParam } from "../../useUrlTab";
import { formatDate } from "../../vendorFormat";

// Reviews page for the partner and host workspaces (2026-10-16): three totals,
// All / Needs a reply tabs, one row per review, and the public reply written
// in a popup. Each workspace passes its own reply call (vendor and host
// reviews use different routes).

export interface ReviewItem {
  id: number;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
  listingName?: string;
  reply: string | null;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="ws-stars" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={13} strokeWidth={1.9} aria-hidden="true" fill={i < rating ? "currentColor" : "none"} data-on={i < rating || undefined} />
      ))}
    </span>
  );
}

export function ReviewsView({ reviews, onReply, replyError }: { reviews: ReviewItem[]; onReply: (id: number, text: string) => Promise<void>; replyError: string }) {
  const [show, setShow] = useUrlParam<"all" | "unanswered">("rshow", "all");
  const [replying, setReplying] = useState<ReviewItem | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unanswered = reviews.filter((r) => !r.reply);
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const rows = show === "all" ? reviews : unanswered;

  const close = () => {
    setReplying(null);
    setText("");
    setError(null);
  };
  const submit = async () => {
    if (!replying || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onReply(replying.id, text.trim());
      close();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : replyError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="ws-stats">
        <StatTile icon={<Star size={17} />} value={reviews.length ? avg.toFixed(1) : "—"} label="Average rating" sublabel="Out of 5" sublabelColor="var(--adm-muted)" />
        <StatTile icon={<MessageSquareReply size={17} />} value={reviews.length} label="Reviews" sublabel="All time" sublabelColor="var(--adm-muted)" />
        <StatTile icon={<MessageSquareReply size={17} />} value={unanswered.length} label="Waiting for a reply" sublabel="Replies are public" sublabelColor="var(--adm-muted)" />
      </div>
      <IconTabs
        label="Show reviews"
        value={show}
        onChange={setShow}
        items={[
          { key: "all", label: "All", icon: Star, count: reviews.length },
          { key: "unanswered", label: "Needs a reply", icon: MessageSquareReply, count: unanswered.length || undefined },
        ]}
      />
      <Box flush>
        {rows.length === 0 ? (
          <EmptyState icon={<Star size={20} />} title={reviews.length === 0 ? "No reviews yet" : "Every review has a reply"} subtitle={reviews.length === 0 ? "Reviews appear here after people take part." : undefined} />
        ) : (
          <ul className="adm-ov-list">
            {rows.map((r) => (
              <li key={r.id} className="ws-review">
                <div className="ws-review-head">
                  <strong>{r.name}</strong>
                  <Stars rating={r.rating} />
                  <span className="adm-note">
                    {[r.listingName, formatDate(r.createdAt)].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <p className="ws-review-body">{r.comment}</p>
                {r.reply ? (
                  <div className="ws-review-reply">
                    <span>Your reply</span>
                    {r.reply}
                  </div>
                ) : (
                  <div>
                    <AdminButton size="sm" onClick={() => setReplying(r)}>
                      Reply
                    </AdminButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Box>

      <AdminModal
        open={replying !== null}
        onClose={close}
        dirty={text.trim().length > 0}
        title={`Reply to ${replying?.name ?? "review"}`}
        subtitle="Your reply is public, shown under the review."
        footer={
          <>
            <AdminButton variant="quiet" onClick={close}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" disabled={busy || !text.trim()} onClick={submit}>
              {busy ? "Posting…" : "Post reply"}
            </AdminButton>
          </>
        }
      >
        {replying && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <blockquote className="ws-review-quote">
              <Stars rating={replying.rating} />
              {replying.comment}
            </blockquote>
            <FormField label="Your reply" required error={error}>
              {(p) => <textarea {...p} className="adm-input" rows={4} value={text} onChange={(e) => setText(e.target.value)} style={{ resize: "vertical" }} />}
            </FormField>
          </div>
        )}
      </AdminModal>
    </div>
  );
}
