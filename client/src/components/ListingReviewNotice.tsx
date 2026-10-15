import { useEffect, useState } from "react";
import { fetchVendorListingDecision, type PublicDecision } from "../api";
import { DecisionExplanation } from "./DecisionExplanation";
import { Button } from "./ui";
import { colors, radius } from "../theme";

// Explains where a submitted listing is in HelloCircle's review, on the
// vendor's own editor page. A rejected listing used to be a dead end: the
// dashboard said it "needs changes before it can go live", but nothing let
// the vendor send it back for review. Now: edit, save, then resubmit.
export function ListingReviewNotice({
  status,
  dirty,
  onResubmit,
  listing,
}: {
  /** D-03: which listing, so a rejection can show HelloCircle's reason. */
  listing?: { type: "centre" | "club" | "experience"; id: string };
  status: string | undefined;
  /** Unsaved edits in the form — resubmitting would send the old version. */
  dirty: boolean;
  /** Calls the listing's publish endpoint (rejected → pending). */
  onResubmit: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ latest: PublicDecision | null } | null>(null);
  const listingKey = listing ? `${listing.type}:${listing.id}` : null;
  useEffect(() => {
    setDecision(null);
    if (status !== "rejected" || !listing) return;
    let live = true;
    fetchVendorListingDecision(listing.type, listing.id)
      .then((d) => live && setDecision({ latest: d.latest?.action === "listing.rejected" ? d.latest : null }))
      .catch(() => live && setDecision(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, listingKey]);
  if (status !== "pending" && status !== "rejected") return null;

  const rejected = status === "rejected";
  return (
    <div
      role="status"
      style={{
        border: `1px solid ${rejected ? colors.danger : colors.border}`,
        background: rejected ? colors.dangerBg : colors.panel,
        borderRadius: radius.card,
        padding: "14px 16px",
        marginBottom: 18,
        display: "flex",
        gap: 14,
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 320px" }}>
        <strong style={{ display: "block", fontSize: 14.5 }}>{rejected ? "Not approved yet — changes needed" : "Waiting for HelloCircle review"}</strong>
        <span style={{ fontSize: 13.5, color: colors.mutedLight }}>
          {rejected
            ? "HelloCircle reviewed this listing and didn't approve it. Update the details below, save, then resubmit it for review. It isn't visible to the public until it's approved."
            : "It isn't visible to the public yet. Changes you save now are included in the review."}
        </span>
        {rejected && listing && decision && <DecisionExplanation decision={decision.latest} />}
        {error && (
          <span role="alert" style={{ display: "block", fontSize: 13, color: colors.danger, fontWeight: 600, marginTop: 6 }}>
            {error}
          </span>
        )}
        {rejected && dirty && (
          <span style={{ display: "block", fontSize: 13, color: colors.mutedLight, marginTop: 6 }}>Save your changes before resubmitting.</span>
        )}
      </div>
      {rejected && (
        <Button
          disabled={busy || dirty}
          aria-busy={busy || undefined}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onResubmit();
            } catch (e) {
              setError(e instanceof Error && e.message ? e.message : "Couldn't resubmit this listing. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Resubmitting…" : "Resubmit for review"}
        </Button>
      )}
    </div>
  );
}
