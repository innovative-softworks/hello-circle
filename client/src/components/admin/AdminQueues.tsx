import { useMemo, useState, type ReactNode } from "react";
import { Award, KeyRound, MapPin } from "lucide-react";
import {
  ApiError,
  fetchAdminListings,
  fetchAdminPlaceSuggestions,
  fetchClaims,
  fetchHostApplications,
  setClaimStatus,
  setHostApplicationStatus,
  setPlaceSuggestionStatus,
  type ClaimSummary,
  type HostApplication,
} from "../../api";
import type { PlaceSuggestion } from "../../types";
import { ConfirmDialog } from "../ui";
import { ObjectActivity } from "./AdminAudit";
import { DecisionHistory, DecisionReasonFields, emptyReason, reasonComplete, toReasonInput, type ReasonDraft } from "./DecisionReason";
import { useAdminCan } from "./adminPermissions";
import { RecordState, RecordView } from "../workspace/RecordView";
import { ContextSection, CopyValue, DetailFacts, DetailSection, DetailStats } from "../workspace/DetailParts";
import { useRecordParam, useUrlParam } from "../../useUrlTab";
import { AdminButton, Box, EmptyMessage, Facts, Loaded, Pager, SearchField, SectionLabel, StatusTag, Toolbar, ViewTabs, formatDate, matches, useAdminData, usePaged, statusLabel, BulkBar, RowMenu, SelectAllHeader, SelectCell, useRowSelection, type AdminData } from "./adminUi";
import { useToast } from "../Toast";
import { flattenListings, rowKey as listingKey } from "./AdminListings";
import { similarListings } from "./listingReview";
import { time, waitingLabel } from "./timeLabels";

/** "15 h" with the exact date underneath, for the queue lists. */
function Waiting({ since }: { since: string | null | undefined }) {
  return (
    <>
      <div>{waitingLabel(since ?? null)?.replace("Waiting ", "") ?? "Unknown"}</div>
      <div className="adm-cell-sub">{formatDate(since ?? null)}</div>
    </>
  );
}
const oldestFirst = <T,>(at: (r: T) => string | null | undefined) => (a: T, b: T) => (time(at(a)) ?? Number.MAX_SAFE_INTEGER) - (time(at(b)) ?? Number.MAX_SAFE_INTEGER);

/** After a decision: open the next waiting item, or go back to the list. */
function useNextAfterDecision(openRecord: (k: string) => void, closeRecord: () => void) {
  const toast = useToast();
  return (nextKey: string | null) => {
    if (nextKey) openRecord(nextKey);
    else {
      closeRecord();
      toast.success("All caught up: nothing else waiting here");
    }
  };
}

// Claims, Host applications and Place suggestions (admin redesign
// 2026-10-14; record pages since the UI completion pass). Each queue is a
// list whose search, view and page live in the URL; "Review" opens the record
// as its own page (`?record=claim:<id>` etc.), where the decision is made
// behind a confirmation that states what actually happens. The decisions are
// the existing API calls — nothing new is decided here, and no reason field
// is invented (none of these endpoints takes one).
//
// The claim and host-application endpoints only list items still waiting for
// a decision, so a record that has since been decided can't be reopened by
// URL; it says so and points to the audit log, which is where decisions are
// kept. Place suggestions can be listed including decided ones.

function Message({ text }: { text?: string | null }) {
  if (!text) return null;
  return <div style={{ fontSize: 12.5, color: "var(--color-muted)", marginTop: 4, maxWidth: 460, whiteSpace: "pre-wrap" }}>{text}</div>;
}

function QueueTable<T>({
  caption,
  rows,
  columns,
  onReview,
  reviewLabel,
  rowKey,
  resetKey,
  noun,
  bulk,
  copy,
}: {
  caption: string;
  rows: T[];
  columns: { label: string; render: (r: T) => ReactNode }[];
  onReview: (r: T) => void;
  reviewLabel: (r: T) => string;
  rowKey: (r: T) => string | number;
  resetKey: string;
  noun: string;
  /** A decision that can be made for several rows at once (the same call per row). */
  bulk?: { label: string; eligible: (r: T) => boolean; title: (n: number) => string; message: string; run: (r: T) => Promise<unknown>; onDone: () => void };
  /** What the row menu's "Copy reference" copies. */
  copy?: (r: T) => string;
}) {
  const paged = usePaged(rows, 20, resetKey, "page");
  const toast = useToast();
  const sel = useRowSelection(bulk ? paged.slice.filter(bulk.eligible).map((r) => String(rowKey(r))) : []);
  const [confirming, setConfirming] = useState(false);
  const runBulk = async () => {
    if (!bulk) return;
    const targets = rows.filter((r) => sel.has(String(rowKey(r))));
    let done = 0;
    for (const r of targets) {
      try {
        await bulk.run(r);
        done++;
      } catch {
        // counted below
      }
    }
    setConfirming(false);
    sel.clear();
    bulk.onDone();
    if (done === targets.length) toast.success(`${done} ${noun.replace(/s$/, "")}${done === 1 ? "" : "s"} done`);
    else toast.error(`${done} of ${targets.length} done; open the others to see why.`);
  };
  return (
    <>
      {bulk && (
        <BulkBar sel={sel} noun={noun.replace(/s$/, "")}>
          <AdminButton variant="primary" size="sm" onClick={() => setConfirming(true)}>
            {bulk.label} {sel.count}
          </AdminButton>
        </BulkBar>
      )}
      <div className="adm-table-wrap">
        <table className="adm-table adm-table--stack">
          <caption className="adm-visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {bulk && <SelectAllHeader sel={sel} label={`Select all ${noun} on this page`} />}
              {columns.map((c) => (
                <th scope="col" key={c.label}>
                  {c.label}
                </th>
              ))}
              <th scope="col">
                <span className="adm-visually-hidden">Review</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.slice.map((r) => (
              <tr key={rowKey(r)}>
                {bulk && <SelectCell sel={sel} rowKey={String(rowKey(r))} label={reviewLabel(r).replace(/^Review /, "Select ")} disabled={!bulk.eligible(r)} />}
                {columns.map((c) => (
                  <td key={c.label} data-label={c.label}>
                    {c.render(r)}
                  </td>
                ))}
                <td>
                  <div className="adm-cell-actions">
                    <AdminButton size="sm" onClick={() => onReview(r)} aria-label={reviewLabel(r)}>
                      Review
                    </AdminButton>
                    <RowMenu name={reviewLabel(r).replace(/^Review /, "")} items={[{ label: "Review", onSelect: () => onReview(r) }]} copy={{ value: copy ? copy(r) : String(rowKey(r)) }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager {...paged} noun={noun} />
      {bulk && (
        <ConfirmDialog open={confirming} title={bulk.title(sel.count)} message={bulk.message} confirmLabel={`${bulk.label} ${sel.count}`} tone="neutral" onConfirm={runBulk} onCancel={() => setConfirming(false)} />
      )}
    </>
  );
}

/** Record-page states shared by the three queues. */
function recordGate<T>(state: AdminData<T[]>, found: T | null, backLabel: string, onBack: () => void, decidedNote: string): ReactNode | null {
  if (state.error && !state.data) {
    const forbidden = state.error instanceof ApiError && (state.error.status === 401 || state.error.status === 403);
    return <RecordState state={forbidden ? "restricted" : "error"} backLabel={backLabel} onBack={onBack} onRetry={state.reload} />;
  }
  if (!state.data) return <RecordState state="loading" backLabel={backLabel} onBack={onBack} />;
  if (!found) return <RecordState state="missing" backLabel={backLabel} onBack={onBack} message={decidedNote} />;
  return null;
}

/** A decision made on this page, kept on screen after the queue drops it. */
type Decided = { status: string; label: string } | null;

// --- claims ---------------------------------------------------------------

function ClaimRecord({ claim, onBack, onOpenVendor, onOpenListing, onDecided }: { claim: ClaimSummary; onBack: () => void; onOpenVendor: (id: string) => void; onOpenListing: (key: string) => void; onDecided: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<"approved" | "rejected" | null>(null);
  const [reason, setReason] = useState<ReasonDraft>(emptyReason);
  const can = useAdminCan();
  const [decided, setDecided] = useState<Decided>(null);
  const listingName = claim.listingName ?? claim.listingId;
  const typeLabel = claim.listingType === "club" ? "Sports club" : "Community centre";
  const vendorReady = claim.vendorStatus === "approved";
  const decide = async (status: "approved" | "rejected") => {
    // A failure keeps the dialog open with the typed reason and the error.
    await setClaimStatus(claim.id, status, status === "rejected" ? toReasonInput(reason) : {});
    setReason(emptyReason());
    setConfirm(null);
    setDecided({ status, label: status === "approved" ? "Approved" : "Rejected" });
    toast.success(status === "approved" ? `${claim.vendorName} now owns ${listingName}` : "Claim rejected");
    onDecided();
  };
  return (
    <RecordView
      title={`Claim on ${listingName}`}
      reference={`Listing ownership claim · ${typeLabel}`}
      backLabel="Claims"
      onBack={onBack}
      stats={
        <DetailStats
          items={[
            { label: decided ? "Decided" : "Waiting", value: decided ? decided.label : (waitingLabel(claim.createdAt) ?? "").replace("Waiting ", "") || "—", sub: `Since ${formatDate(claim.createdAt)}` },
            { label: "Listing", value: typeLabel, sub: listingName },
            { label: "Partner account", value: claim.vendorStatus === "approved" ? "Approved" : statusLabel(claim.vendorStatus), sub: vendorReady ? "Can take ownership" : "Approve the account first" },
          ]}
        />
      }
      asideLabel="Partner, listing and claim details"
      aside={
        <>
          <ContextSection title="Claimed by">
            <div className="wd-ctx-name">{claim.vendorName}</div>
            <a className="wd-ctx-sub" href={`mailto:${claim.vendorEmail}`}>
              {claim.vendorEmail}
            </a>
            <div style={{ marginTop: 10 }} />
            <AdminButton size="sm" onClick={() => onOpenVendor(claim.vendorId)}>
              Open partner account
            </AdminButton>
          </ContextSection>
          <ContextSection title="Listing">
            <div className="wd-ctx-name">{listingName}</div>
            <div className="wd-ctx-sub" style={{ marginBottom: 10 }}>{typeLabel}</div>
            <AdminButton size="sm" onClick={() => onOpenListing(`${claim.listingType}:${claim.listingId}`)}>
              Open listing
            </AdminButton>
          </ContextSection>
          <ContextSection title="Claim details">
            <DetailFacts columns={1} rows={[["Claim ID", <CopyValue value={String(claim.id)} label="claim ID" />], ["Submitted", formatDate(claim.createdAt, true)]]} />
          </ContextSection>
        </>
      }
      statuses={
        <>
          <span className="adm-note">Claim:</span> <StatusTag status={decided?.status ?? "pending"} label={decided?.label ?? "Waiting for a decision"} />
          <span className="adm-note">Partner account:</span> <StatusTag status={claim.vendorStatus} label={claim.vendorStatus === "approved" ? "Approved" : undefined} />
        </>
      }
      actions={
        decided || !can("queues.decide") ? null : (
          <>
            <AdminButton onClick={() => setConfirm("rejected")}>Reject claim</AdminButton>
            <AdminButton variant="primary" disabled={!vendorReady} onClick={() => setConfirm("approved")} aria-describedby={vendorReady ? undefined : "claim-blocked"}>
              Approve claim
            </AdminButton>
          </>
        )
      }
    >
      {!vendorReady && !decided && (
        <p id="claim-blocked" className="adm-note" role="note" style={{ color: "var(--color-orange-dark)" }}>
          The partner's account is {claim.vendorStatus}. Approve the account first — the server refuses a claim from an account that isn't approved.
        </p>
      )}
      {decided && (
        <p className="adm-note" role="status">
          Decision saved. This claim has left the queue; it stays in the audit log.
        </p>
      )}
      <DetailSection title="Message from the partner">
        <p className="adm-review-text">{claim.message || <span className="adm-note">None.</span>}</p>
      </DetailSection>
      <DetailSection title="Decisions">
        <DecisionHistory objectType="claim" objectId={String(claim.id)} refreshKey={decided?.status} />
      </DetailSection>
      <DetailSection title="History">
        <ObjectActivity objectIds={[claim.listingId]} note="Claim decisions are recorded against the listing, so this shows the listing's recent audited changes too." />
      </DetailSection>
      <ConfirmDialog
        open={confirm === "approved"}
        title={`Approve ${claim.vendorName}'s claim on ${listingName}?`}
        message={`${claim.vendorName} becomes the owner of this ${typeLabel.toLowerCase()}: it moves into their workspace, where they can edit it and see its bookings. The server refuses this if another partner has taken ownership in the meantime. They aren't notified automatically.`}
        confirmLabel="Approve claim"
        tone="neutral"
        onConfirm={() => decide("approved")}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "rejected"}
        title={`Reject ${claim.vendorName}'s claim on ${listingName}?`}
        message="The listing stays unowned. The partner is told the reason category and your explanation (in their workspace notifications and by email) and can submit a new claim. The internal note isn't sent."
        confirmLabel="Reject claim"
        tone="neutral"
        confirmDisabled={!reasonComplete(reason)}
        onConfirm={() => decide("rejected")}
        onCancel={() => setConfirm(null)}
      >
        <DecisionReasonFields kind="application_rejection" audience="partner" value={reason} onChange={setReason} />
      </ConfirmDialog>
    </RecordView>
  );
}

export function AdminClaimsPage({ onOpenVendor, onOpenListing, onCountsChanged }: { onOpenVendor: (id: string) => void; onOpenListing: (key: string) => void; onCountsChanged?: () => void }) {
  const can = useAdminCan();
  const state = useAdminData(fetchClaims);
  const [q, setQ] = useUrlParam<string>("q", "");
  const [record, openRecord, closeRecord] = useRecordParam();
  // Snapshot of the record being reviewed, so a decision doesn't make the page vanish.
  const [held, setHeld] = useState<ClaimSummary | null>(null);
  const goNext = useNextAfterDecision(openRecord, closeRecord);
  const rows = (state.data ?? []).filter((c) => matches(q, c.listingName, c.vendorName, c.vendorEmail)).sort(oldestFirst((c) => c.createdAt));

  if (record) {
    const id = record.replace(/^claim:/, "");
    const found = (state.data ?? []).find((c) => String(c.id) === id) ?? (held && String(held.id) === id ? held : null);
    const gate = recordGate(state, found, "Claims", closeRecord, "Only claims waiting for a decision can be opened here. Decided claims are kept in the audit log.");
    if (gate) return gate;
    return (
      <ClaimRecord
        claim={found!}
        onBack={closeRecord}
        onOpenVendor={onOpenVendor}
        onOpenListing={onOpenListing}
        onDecided={() => {
          setHeld(found);
          state.reload();
          onCountsChanged?.();
          const next = (state.data ?? []).filter((c) => c.id !== found!.id).sort(oldestFirst((c) => c.createdAt))[0];
          goNext(next ? `claim:${next.id}` : null);
        }}
      />
    );
  }

  return (
    <Box flush>
      <Toolbar label="Search claims">
        <SearchField label="Search claims" value={q} onChange={setQ} placeholder="Listing, partner or email" />
      </Toolbar>
      <Loaded state={state}>
        {(all) =>
          rows.length === 0 ? (
            <EmptyMessage icon={<KeyRound size={22} strokeWidth={1.9} aria-hidden="true" />} title={all.length ? "No claims match" : "No claims waiting"} detail={all.length ? undefined : "No listing ownership claims are pending review."} />
          ) : (
            <QueueTable
              caption="Pending listing claims"
              noun="claims"
              resetKey={q}
              rows={rows}
              rowKey={(c) => c.id}
              copy={(c) => String(c.id)}
              bulk={
                can("queues.decide")
                  ? {
                      label: "Approve",
                      eligible: (c) => c.vendorStatus === "approved",
                      title: (n) => `Approve ${n} claim${n === 1 ? "" : "s"}?`,
                      message: "Each partner becomes the owner of the listing they claimed, the same as approving one claim from its page. Claims from accounts that aren't approved can't be selected. The server refuses a claim if another partner took ownership in the meantime.",
                      run: (c) => setClaimStatus(c.id, "approved"),
                      onDone: () => {
                        state.reload();
                        onCountsChanged?.();
                      },
                    }
                  : undefined
              }
              onReview={(c) => openRecord(`claim:${c.id}`)}
              reviewLabel={(c) => `Review claim on ${c.listingName ?? c.listingId}`}
              columns={[
                { label: "Listing", render: (c) => <><div className="adm-cell-title">{c.listingName ?? c.listingId}</div><div className="adm-cell-sub">{c.listingType === "club" ? "Sports club" : "Community centre"}</div></> },
                {
                  label: "Claimed by",
                  render: (c) => (
                    <>
                      <div className="adm-cell-title">{c.vendorName}</div>
                      <div className="adm-cell-sub">{c.vendorEmail}</div>
                      {c.vendorStatus !== "approved" && <div className="adm-cell-sub" style={{ color: "var(--color-orange-dark)" }}>Partner account {c.vendorStatus} — approve the account first</div>}
                      <Message text={c.message} />
                    </>
                  ),
                },
                { label: "Waiting", render: (c) => <Waiting since={c.createdAt} /> },
              ]}
            />
          )
        }
      </Loaded>
    </Box>
  );
}

// --- host applications ------------------------------------------------------

function HostApplicationRecord({ app, onBack, onDecided }: { app: HostApplication; onBack: () => void; onDecided: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<"verified" | "rejected" | null>(null);
  const [reason, setReason] = useState<ReasonDraft>(emptyReason);
  const can = useAdminCan();
  const [decided, setDecided] = useState<Decided>(null);
  const decide = async (status: "verified" | "rejected") => {
    await setHostApplicationStatus(app.id, status, status === "rejected" ? toReasonInput(reason) : {});
    setReason(emptyReason());
    setConfirm(null);
    setDecided({ status: status === "verified" ? "approved" : "rejected", label: status === "verified" ? "Verified Host" : "Declined" });
    toast.success(status === "verified" ? `${app.name} is now a Verified Host` : "Application declined");
    onDecided();
  };
  return (
    <RecordView
      title={app.name}
      reference="Verified Host application"
      backLabel="Host applications"
      onBack={onBack}
      stats={
        <DetailStats
          items={[
            { label: decided ? "Decided" : "Waiting", value: decided ? decided.label : (waitingLabel(app.appliedAt) ?? "").replace("Waiting ", "") || "—", sub: `Applied ${formatDate(app.appliedAt)}` },
            { label: "About them", value: app.bio ? `${app.bio.trim().split(/\s+/).length} words` : "Not given", sub: "Written by the applicant" },
            { label: "Phone", value: app.phone ? "Given" : "Not given", sub: app.phone || undefined },
          ]}
        />
      }
      asideLabel="Contact and application details"
      aside={
        <>
          <ContextSection title="Contact">
            <div className="wd-ctx-name">{app.name}</div>
            <a className="wd-ctx-sub" href={`mailto:${app.email}`}>
              {app.email}
            </a>
            <div className="wd-ctx-sub">{app.phone ? `Phone ${app.phone}` : "No phone given"}</div>
          </ContextSection>
          <ContextSection title="Application details">
            <DetailFacts columns={1} rows={[["Resident ID", <CopyValue value={app.id} label="resident ID" />], ["Applied", formatDate(app.appliedAt, true)]]} />
          </ContextSection>
          <ContextSection title="What this decides">
            <p className="adm-note">Residents can host Games and Circles either way — this only grants or declines the Verified Host badge. There's no separate admin page for a resident account.</p>
          </ContextSection>
        </>
      }
      statuses={
        <>
          <span className="adm-note">Application:</span> <StatusTag status={decided?.status ?? "pending"} label={decided?.label ?? "Waiting for a decision"} />
        </>
      }
      actions={
        decided || !can("queues.decide") ? null : (
          <>
            <AdminButton onClick={() => setConfirm("rejected")}>Decline</AdminButton>
            <AdminButton variant="primary" onClick={() => setConfirm("verified")}>
              Approve as Verified Host
            </AdminButton>
          </>
        )
      }
    >
      {decided && (
        <p className="adm-note" role="status">
          Decision saved. This application has left the queue; it stays in the audit log.
        </p>
      )}
      <DetailSection title="About them">
        <p className="adm-review-text">{app.bio || <span className="adm-note">Not provided.</span>}</p>
      </DetailSection>
      <DetailSection title="Decisions">
        <DecisionHistory objectType="host_application" objectId={app.id} refreshKey={decided?.status} />
      </DetailSection>
      <DetailSection title="History">
        <ObjectActivity objectIds={[app.id]} note="Host status decisions for this resident are recorded." />
      </DetailSection>
      <ConfirmDialog
        open={confirm === "verified"}
        title={`Approve ${app.name} as a Verified Host?`}
        message="Their profile and the activities they host show “Host application approved” (it says plainly that it isn't an identity check). Their ability to host doesn't change. They aren't notified automatically."
        confirmLabel="Approve as Verified Host"
        tone="neutral"
        onConfirm={() => decide("verified")}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "rejected"}
        title={`Decline ${app.name}'s application?`}
        message="They keep hosting Games and Circles as before, without the badge. They're told the reason category and your explanation in their HelloCircle notifications and by email, and can reapply. The internal note isn't sent."
        confirmLabel="Decline application"
        tone="neutral"
        confirmDisabled={!reasonComplete(reason)}
        onConfirm={() => decide("rejected")}
        onCancel={() => setConfirm(null)}
      >
        <DecisionReasonFields kind="application_rejection" audience="applicant" value={reason} onChange={setReason} />
      </ConfirmDialog>
    </RecordView>
  );
}

export function AdminHostApplicationsPage({ onCountsChanged }: { onCountsChanged?: () => void }) {
  const can = useAdminCan();
  const state = useAdminData(fetchHostApplications);
  const [q, setQ] = useUrlParam<string>("q", "");
  const [record, openRecord, closeRecord] = useRecordParam();
  const [held, setHeld] = useState<HostApplication | null>(null);
  const goNext = useNextAfterDecision(openRecord, closeRecord);
  const rows = (state.data ?? []).filter((a) => matches(q, a.name, a.email, a.phone)).sort(oldestFirst((a) => a.appliedAt));

  if (record) {
    const id = record.replace(/^host:/, "");
    const found = (state.data ?? []).find((a) => a.id === id) ?? (held?.id === id ? held : null);
    const gate = recordGate(state, found, "Host applications", closeRecord, "Only applications waiting for a decision can be opened here. Decisions are kept in the audit log.");
    if (gate) return gate;
    return (
      <HostApplicationRecord
        app={found!}
        onBack={closeRecord}
        onDecided={() => {
          setHeld(found);
          state.reload();
          onCountsChanged?.();
          const next = (state.data ?? []).filter((a) => a.id !== found!.id).sort(oldestFirst((a) => a.appliedAt))[0];
          goNext(next ? `host:${next.id}` : null);
        }}
      />
    );
  }

  return (
    <Box flush>
      <Toolbar label="Search host applications">
        <SearchField label="Search applications" value={q} onChange={setQ} placeholder="Name, email or phone" />
      </Toolbar>
      <Loaded state={state}>
        {(all) =>
          rows.length === 0 ? (
            <EmptyMessage icon={<Award size={22} strokeWidth={1.9} aria-hidden="true" />} title={all.length ? "No applications match" : "No host applications waiting"} />
          ) : (
            <QueueTable
              caption="Verified Host applications"
              noun="applications"
              resetKey={q}
              rows={rows}
              rowKey={(a) => a.id}
              copy={(a) => a.email}
              bulk={
                can("queues.decide")
                  ? {
                      label: "Approve",
                      eligible: () => true,
                      title: (n) => `Approve ${n} application${n === 1 ? "" : "s"} as Verified Host?`,
                      message: "Each person gets the Verified Host badge, the same as approving one application from its page. Their ability to host doesn't change.",
                      run: (a) => setHostApplicationStatus(a.id, "verified"),
                      onDone: () => {
                        state.reload();
                        onCountsChanged?.();
                      },
                    }
                  : undefined
              }
              onReview={(a) => openRecord(`host:${a.id}`)}
              reviewLabel={(a) => `Review ${a.name}'s application`}
              columns={[
                { label: "Applicant", render: (a) => <><div className="adm-cell-title">{a.name}</div><div className="adm-cell-sub">{[a.email, a.phone].filter(Boolean).join(" · ")}</div><Message text={a.bio} /></> },
                { label: "Waiting", render: (a) => <Waiting since={a.appliedAt} /> },
              ]}
            />
          )
        }
      </Loaded>
      <p className="adm-note" style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)" }}>
        Residents can host Games and Circles either way — this only grants or declines the Verified Host badge.
      </p>
    </Box>
  );
}

// --- place suggestions --------------------------------------------------------

const SUGGESTION_LABEL: Record<PlaceSuggestion["status"], string> = { pending: "Waiting for a decision", approved: "Published", rejected: "Rejected" };

function SuggestionRecord({ s, onBack, onOpenListing, onDecided }: { s: PlaceSuggestion; onBack: () => void; onOpenListing: (key: string) => void; onDecided: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<"approved" | "rejected" | null>(null);
  const [reason, setReason] = useState<ReasonDraft>(emptyReason);
  const can = useAdminCan();
  const typeLabel = s.category === "club" ? "sports club" : "community centre";
  // "Not on HelloCircle yet" is the suggester's guess; check it before publishing a duplicate.
  const listings = useAdminData(fetchAdminListings);
  const similar = useMemo(
    () => (listings.data && s.status === "pending" ? similarListings({ id: "", name: s.suggestedName, county: s.county }, flattenListings(listings.data)) : []),
    [listings.data, s.status, s.suggestedName, s.county]
  );
  const decide = async (status: "approved" | "rejected") => {
    await setPlaceSuggestionStatus(s.id, status, status === "rejected" ? toReasonInput(reason) : {});
    setReason(emptyReason());
    setConfirm(null);
    toast.success(status === "approved" ? `${s.suggestedName} published` : "Suggestion rejected");
    onDecided();
  };
  return (
    <RecordView
      title={s.suggestedName}
      reference={`Place suggestion · ${s.category === "club" ? "Sports club" : "Community centre"}${s.county ? ` · ${s.county}` : ""}`}
      backLabel="Place suggestions"
      onBack={onBack}
      stats={
        <DetailStats
          items={[
            { label: s.status === "pending" ? "Waiting" : "Status", value: s.status === "pending" ? (waitingLabel(s.createdAt) ?? "").replace("Waiting ", "") || "—" : SUGGESTION_LABEL[s.status], sub: `Since ${formatDate(s.createdAt)}` },
            { label: "Type", value: s.category === "club" ? "Sports club" : "Community centre", sub: [s.area, s.county].filter(Boolean).join(", ") || "No area given" },
            { label: "Possible duplicates", value: listings.data ? String(similar.length) : "…", sub: similar.length ? "Check before publishing" : "None found" },
          ]}
        />
      }
      asideLabel="Duplicates, contact and suggestion details"
      aside={
        <>
          {similar.length > 0 && (
            <ContextSection title="Possibly already listed">
              <div className="wd-ctx" data-tone="warn" style={{ margin: 0 }}>
                <p className="adm-note">Check these before publishing, so the same place isn't listed twice.</p>
                <ul className="adm-similar">
                  {similar.map((l) => (
                    <li key={listingKey(l)}>
                      <button type="button" className="adm-linkish" onClick={() => onOpenListing(listingKey(l))}>
                        {l.item.name}
                      </button>
                      <span className="adm-cell-sub">
                        {[l.item.area, l.item.county].filter(Boolean).join(", ")} · {l.item.vendorName ?? "Unclaimed"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </ContextSection>
          )}
          <ContextSection title="Contact given">
            <p style={{ overflowWrap: "anywhere" }}>{s.contactInfo || <span className="adm-note">None</span>}</p>
          </ContextSection>
          <ContextSection title="Published listing">
            {s.publishedListingId ? (
              <AdminButton size="sm" onClick={() => onOpenListing(`${s.category}:${s.publishedListingId}`)}>
                Open published listing
              </AdminButton>
            ) : (
              <p className="adm-note">{s.status === "rejected" ? "No listing was created." : "A listing is created when this is approved."}</p>
            )}
          </ContextSection>
          <ContextSection title="Suggestion details">
            <DetailFacts columns={1} rows={[["Suggestion ID", <CopyValue value={s.id} label="suggestion ID" />], ["Submitted", formatDate(s.createdAt, true)]]} />
          </ContextSection>
        </>
      }
      statuses={
        <>
          <span className="adm-note">Suggestion:</span> <StatusTag status={s.status} label={SUGGESTION_LABEL[s.status]} />
        </>
      }
      actions={
        s.status === "pending" && can("queues.decide") ? (
          <>
            <AdminButton onClick={() => setConfirm("rejected")}>Reject</AdminButton>
            <AdminButton variant="primary" onClick={() => setConfirm("approved")}>
              Approve &amp; publish
            </AdminButton>
          </>
        ) : null
      }
    >
      <DetailSection title="Suggested place">
        <DetailFacts
          rows={[
            ["Type", s.category === "club" ? "Sports club" : "Community centre"],
            ["Area", s.area || "Not given"],
            ["County", s.county || "Not given"],
          ]}
        />
        <h3 className="wd-sub">Description</h3>
        <p className="adm-review-text">{s.description || <span className="adm-note">None.</span>}</p>
      </DetailSection>
      <DetailSection title="Decisions">
        <DecisionHistory objectType="place_suggestion" objectId={s.id} currentNeedsReason={s.status === "rejected"} refreshKey={s.status} />
      </DetailSection>
      <DetailSection title="History">
        <ObjectActivity objectIds={[s.id]} note="Approval and rejection are recorded." />
      </DetailSection>
      <ConfirmDialog
        open={confirm === "approved"}
        title={`Publish ${s.suggestedName} as a ${typeLabel}?`}
        message={`Creates a live, unowned ${typeLabel} listing from this suggestion, at an approximate map position in ${s.county || "Dublin (no county given)"}${s.category === "centre" ? ", with one default room and pay-on-arrival" : ", with pay-on-arrival"}. A partner can claim it later.`}
        confirmLabel="Approve & publish"
        tone="neutral"
        onConfirm={() => decide("approved")}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "rejected"}
        title={`Reject the suggestion "${s.suggestedName}"?`}
        message="No listing is created. The person who suggested it sees the reason category and your explanation next to their suggestion, and in their notifications if they were signed in. The internal note isn't shown."
        confirmLabel="Reject suggestion"
        tone="neutral"
        confirmDisabled={!reasonComplete(reason)}
        onConfirm={() => decide("rejected")}
        onCancel={() => setConfirm(null)}
      >
        <DecisionReasonFields kind="application_rejection" audience="applicant" value={reason} onChange={setReason} />
      </ConfirmDialog>
    </RecordView>
  );
}

export function AdminPlaceSuggestionsPage({ onOpenListing, onCountsChanged }: { onOpenListing: (key: string) => void; onCountsChanged?: () => void }) {
  const can = useAdminCan();
  const [view, setView] = useUrlParam<"pending" | "all">("view", "pending");
  const [q, setQ] = useUrlParam<string>("q", "");
  const [record, openRecord, closeRecord] = useRecordParam();
  // A record opened by URL may already be decided, so look it up in the full list.
  const state = useAdminData(() => fetchAdminPlaceSuggestions(view === "all" || !!record), [view, !!record]);
  const goNext = useNextAfterDecision(openRecord, closeRecord);
  const rows = (state.data ?? [])
    .filter((s) => (view === "all" || s.status === "pending") && matches(q, s.suggestedName, s.area, s.county, s.contactInfo))
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || oldestFirst<PlaceSuggestion>((x) => x.createdAt)(a, b));

  if (record) {
    const id = record.replace(/^suggestion:/, "");
    const found = (state.data ?? []).find((s) => s.id === id) ?? null;
    const gate = recordGate(state, found, "Place suggestions", closeRecord, "No place suggestion has this reference.");
    if (gate) return gate;
    return (
      <SuggestionRecord
        s={found!}
        onBack={closeRecord}
        onOpenListing={onOpenListing}
        onDecided={() => {
          state.reload();
          onCountsChanged?.();
          const next = (state.data ?? []).filter((x) => x.status === "pending" && x.id !== found!.id).sort(oldestFirst((x) => x.createdAt))[0];
          goNext(next ? `suggestion:${next.id}` : null);
        }}
      />
    );
  }

  return (
    <Box flush>
      <ViewTabs
        label="Suggestion status"
        value={view}
        onChange={setView}
        views={[
          { key: "pending", label: "Waiting for a decision" },
          { key: "all", label: "All, including decided" },
        ]}
      />
      <Toolbar label="Search place suggestions">
        <SearchField label="Search suggestions" value={q} onChange={setQ} placeholder="Name, area, county or contact" />
      </Toolbar>
      <Loaded state={state}>
        {(all) =>
          rows.length === 0 ? (
            <EmptyMessage icon={<MapPin size={22} strokeWidth={1.9} aria-hidden="true" />} title={all.length && q ? "No suggestions match" : view === "pending" ? "No place suggestions waiting" : "No place suggestions yet"} />
          ) : (
            <QueueTable
              caption="Place suggestions"
              noun="suggestions"
              resetKey={`${q}|${view}`}
              rows={rows}
              rowKey={(s) => s.id}
              copy={(s) => s.id}
              bulk={
                can("queues.decide")
                  ? {
                      label: "Approve & publish",
                      eligible: (s) => s.status === "pending",
                      title: (n) => `Publish ${n} suggestion${n === 1 ? "" : "s"}?`,
                      message: "Each creates a live, unowned listing at an approximate map position, the same as approving one suggestion from its page. A partner can claim it later. Only suggestions still waiting can be selected.",
                      run: (s) => setPlaceSuggestionStatus(s.id, "approved"),
                      onDone: () => {
                        state.reload();
                        onCountsChanged?.();
                      },
                    }
                  : undefined
              }
              onReview={(s) => openRecord(`suggestion:${s.id}`)}
              reviewLabel={(s) => `Review ${s.suggestedName}`}
              columns={[
                {
                  label: "Place",
                  render: (s) => (
                    <>
                      <div className="adm-cell-title">{s.suggestedName}</div>
                      <div className="adm-cell-sub">
                        {s.category === "club" ? "Sports club" : "Community centre"} · {[s.area, s.county].filter(Boolean).join(", ") || "No location given"}
                      </div>
                      <Message text={s.description} />
                    </>
                  ),
                },
                { label: "Waiting", render: (s) => (s.status === "pending" ? <Waiting since={s.createdAt} /> : formatDate(s.createdAt)) },
                { label: "Status", render: (s) => <StatusTag status={s.status} label={s.status === "approved" ? "Published" : undefined} /> },
              ]}
            />
          )
        }
      </Loaded>
    </Box>
  );
}
