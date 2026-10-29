import { useEffect, useId, useState } from "react";
import { EXPLANATION_MAX, EXPLANATION_MIN, NOTE_MAX, REASON_CATEGORIES, fetchDecisionHistory, type AdminDecision, type DecisionReasonInput, type ReasonKind } from "../../api";
import { ErrorMessage, formatDate } from "./adminUi";

// D-03 — the reason form used inside decision confirmations, and the decision
// history shown on record pages. The explanation is visible to the partner or
// applicant; the internal note is stored separately and only shown to admins
// whose role allows internal notes (the server leaves it out otherwise).

export type ReasonDraft = { reasonCategory: string; explanation: string; internalNote: string };
export const emptyReason = (): ReasonDraft => ({ reasonCategory: "", explanation: "", internalNote: "" });

/** True when the draft would pass the server's validation for a required reason. */
export function reasonComplete(d: ReasonDraft, needsCategory = true): boolean {
  const e = d.explanation.trim().length;
  return (!needsCategory || !!d.reasonCategory) && e >= EXPLANATION_MIN && e <= EXPLANATION_MAX && d.internalNote.trim().length <= NOTE_MAX;
}

export function toReasonInput(d: ReasonDraft): DecisionReasonInput {
  return {
    reasonCategory: d.reasonCategory || undefined,
    explanation: d.explanation.trim() || undefined,
    internalNote: d.internalNote.trim() || undefined,
  };
}

export function DecisionReasonFields({
  kind,
  value,
  onChange,
  audience,
  explanationOptional = false,
  categoryless = false,
}: {
  kind: ReasonKind;
  value: ReasonDraft;
  onChange: (next: ReasonDraft) => void;
  /** Who reads the explanation: "partner" or "applicant". */
  audience: "partner" | "applicant";
  /** Reinstatement: an optional message instead of a required explanation. */
  explanationOptional?: boolean;
  /** Reinstatement has no category. */
  categoryless?: boolean;
}) {
  const id = useId();
  const set = (patch: Partial<ReasonDraft>) => onChange({ ...value, ...patch });
  const len = value.explanation.trim().length;
  const short = !explanationOptional && len > 0 && len < EXPLANATION_MIN;
  return (
    <div className="adm-reason" style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14, textAlign: "left" }}>
      {!categoryless && (
        <div className="adm-field">
          <label htmlFor={`${id}-cat`}>
            Reason category <span aria-hidden="true">*</span>
          </label>
          <select id={`${id}-cat`} className="adm-select" required value={value.reasonCategory} onChange={(e) => set({ reasonCategory: e.target.value })}>
            <option value="">Choose a category…</option>
            {REASON_CATEGORIES[kind].map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="adm-field">
        <label htmlFor={`${id}-exp`}>
          {explanationOptional ? `Message to the ${audience}` : "Explanation"} {!explanationOptional && <span aria-hidden="true">*</span>}{" "}
          <span className="adm-reason-tag" data-tone="visible">
            Visible to the {audience}
          </span>
        </label>
        <textarea
          id={`${id}-exp`}
          className="adm-input"
          rows={4}
          required={!explanationOptional}
          maxLength={EXPLANATION_MAX}
          aria-describedby={`${id}-exp-hint`}
          aria-invalid={short || undefined}
          value={value.explanation}
          onChange={(e) => set({ explanation: e.target.value })}
        />
        <p id={`${id}-exp-hint`} className="adm-note" style={{ margin: "4px 0 0" }}>
          {explanationOptional
            ? `Optional. Sent to the ${audience} as written.`
            : `Sent to the ${audience} as written, with the category. At least ${EXPLANATION_MIN} characters (${len}/${EXPLANATION_MAX}).`}
        </p>
      </div>
      <div className="adm-field">
        <label htmlFor={`${id}-note`}>
          Internal note <span style={{ fontWeight: 400 }}>(optional)</span>{" "}
          <span className="adm-reason-tag" data-tone="internal">
            Not shown to the {audience}
          </span>
        </label>
        <textarea id={`${id}-note`} className="adm-input" rows={3} maxLength={NOTE_MAX} aria-describedby={`${id}-note-hint`} value={value.internalNote} onChange={(e) => set({ internalNote: e.target.value })} />
        <p id={`${id}-note-hint`} className="adm-note" style={{ margin: "4px 0 0" }}>
          Kept with the decision for admins whose role can see internal notes (super, support, legal).
        </p>
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  "listing.approved": "Approved and published",
  "listing.rejected": "Rejected",
  "verification.approved": "Check approved",
  "verification.rejected": "Check declined",
  "verification.revoked": "Check withdrawn",
  "listing.pending": "Moved back to review",
  "listing.deleted": "Deleted",
  "partner.approved": "Account approved",
  "partner.suspended": "Account suspended",
  "partner.reinstated": "Account reinstated",
  "partner.pending": "Moved back to pending",
  "claim.approved": "Claim approved",
  "claim.rejected": "Claim rejected",
  "host_application.verified": "Approved as Verified Host",
  "host_application.rejected": "Application declined",
  "place_suggestion.approved": "Published",
  "place_suggestion.rejected": "Rejected",
  "org.suspended": "Organisation suspended",
  "org.reinstated": "Organisation reinstated",
};
const NEEDS_REASON = new Set(["verification.rejected", "verification.revoked", "listing.rejected", "partner.suspended", "org.suspended", "claim.rejected", "host_application.rejected", "place_suggestion.rejected"]);

/** Decision history for a record. `currentNeedsReason` = the record is rejected/suspended now. */
export function DecisionHistory({ objectType, objectId, currentNeedsReason, refreshKey }: { objectType: string; objectId: string; currentNeedsReason?: boolean; refreshKey?: unknown }) {
  const [state, setState] = useState<{ includesInternalNotes: boolean; decisions: AdminDecision[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => {
    setError(null);
    fetchDecisionHistory(objectType, objectId)
      .then(setState)
      .catch(setError);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [objectType, objectId, refreshKey]);
  if (error) return <ErrorMessage error={error} onRetry={load} title="Couldn't load the decision history" />;
  if (!state) return <p className="adm-note" role="status">Loading decisions…</p>;
  const { decisions, includesInternalNotes } = state;
  return (
    <div className="adm-decisions">
      {decisions.length === 0 ? (
        <p className="adm-note">{currentNeedsReason ? "No reason recorded. This decision was made before reasons were recorded." : "No decisions recorded yet."}</p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--adm-line, var(--color-border))" }}>
          {decisions.map((d) => (
            <li key={d.id} style={{ padding: "10px 12px", borderBottom: "1px solid var(--adm-line, var(--color-border))" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13.5 }}>{ACTION_LABEL[d.action] ?? d.action}</strong>
                <span className="adm-note">
                  {formatDate(d.decidedAt, true)}
                  {d.actorEmail ? ` · ${d.actorEmail}` : ""}
                </span>
              </div>
              {d.categoryLabel && <div style={{ fontSize: 13, marginTop: 4 }}>Reason: {d.categoryLabel}</div>}
              {d.explanation ? (
                <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>
                  <span className="adm-reason-tag" data-tone="visible">
                    Sent to them
                  </span>{" "}
                  {d.explanation}
                </div>
              ) : (
                NEEDS_REASON.has(d.action) && <div className="adm-note">No reason recorded.</div>
              )}
              {includesInternalNotes && d.internalNote && (
                <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>
                  <span className="adm-reason-tag" data-tone="internal">
                    Internal note
                  </span>{" "}
                  {d.internalNote}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {!includesInternalNotes && <p className="adm-note" style={{ marginTop: 6 }}>Internal notes aren't shown for your admin role.</p>}
    </div>
  );
}
