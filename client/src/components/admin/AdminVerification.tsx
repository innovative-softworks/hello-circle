import { useEffect, useState } from "react";
import { irelandToday } from "../../irelandDate";
import { BadgeCheck, ClipboardCheck } from "lucide-react";
import {
  ApiError,
  approveVerification,
  decideAdminAttendanceCorrection,
  declineVerification,
  fetchAdminAttendanceCorrections,
  fetchVerificationCase,
  fetchVerificationQueue,
  requestVerificationInfo,
  type AttendanceCorrection,
  type CheckAvailability,
  type CheckStatus,
  type VerificationCase,
  type VerificationListRow,
} from "../../api";
import { ConfirmDialog } from "../ui";
import { useToast } from "../Toast";
import { ObjectActivity } from "./AdminAudit";
import { DecisionHistory, DecisionReasonFields, emptyReason, reasonComplete, toReasonInput, type ReasonDraft } from "./DecisionReason";
import { useAdminCan } from "./adminPermissions";
import { AdminButton, Box, EmptyMessage, Loaded, Pager, StatusTag, ViewTabs, formatDate, useAdminData, usePaged } from "./adminUi";
import { RecordState, RecordView } from "../workspace/RecordView";
import { ContextSection, CopyValue, DetailFacts, DetailSection } from "../workspace/DetailParts";
import { useRecordParam, useUrlParam } from "../../useUrlTab";

// Trust & Retention batch 1 — verification checks (admin). A queue of check
// cases and a record page per case: request more information, approve with a
// written note of what was checked (and an optional expiry), decline or
// withdraw with a D-03 reason the partner sees. The evidence note is shown
// only to roles allowed to read internal notes; the server enforces that.
// Identity checks are listed as unavailable — the server refuses them.

const CHECK_LABEL: Record<string, string> = { business_details: "Business details", identity: "Identity", organiser_identity: "Organiser identity" };
const STATUS_LABEL: Record<CheckStatus, string> = {
  pending: "Waiting for a decision",
  more_info: "Waiting for the partner",
  approved: "Approved",
  rejected: "Declined",
  revoked: "Withdrawn",
  expired: "Expired",
};
const STATUS_TONE: Record<CheckStatus, string> = { pending: "pending", more_info: "pending", approved: "approved", rejected: "rejected", revoked: "rejected", expired: "rejected" };

function Availability({ availability }: { availability: CheckAvailability | undefined }) {
  if (!availability) return null;
  const off = (Object.keys(availability) as (keyof CheckAvailability)[]).filter((k) => !availability[k].available);
  if (!off.length) return null;
  return (
    <p className="adm-note" style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)" }}>
      {off.map((k) => CHECK_LABEL[k]).join(" and ")} checks are unavailable: {availability[off[0]].why}
    </p>
  );
}

function CheckRecord({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const can = useAdminCan();
  const toast = useToast();
  const [data, setData] = useState<VerificationCase | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<"info" | "approve" | "reject" | "revoke" | null>(null);
  const [text, setText] = useState("");
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState<ReasonDraft>(emptyReason);
  const [actionError, setActionError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    fetchVerificationCase(id)
      .then(setData)
      .catch(setError);
  };
  useEffect(load, [id]);

  if (error) {
    const forbidden = error instanceof ApiError && (error.status === 401 || error.status === 403);
    const missing = error instanceof ApiError && error.status === 404;
    return <RecordState state={forbidden ? "restricted" : missing ? "missing" : "error"} backLabel="Verification checks" onBack={onBack} onRetry={load} />;
  }
  if (!data) return <RecordState state="loading" backLabel="Verification checks" onBack={onBack} />;
  const { check, subject } = data;
  const decide = can("queues.decide");
  const close = () => {
    setDialog(null);
    setText("");
    setExpires("");
    setReason(emptyReason());
    setActionError(null);
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setActionError(null);
    try {
      await fn();
      toast.success(done);
      close();
      load();
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That didn't work. Reload and try again.");
      throw e;
    }
  };

  return (
    <RecordView
      title={subject?.name ?? check.subjectId}
      reference={`${CHECK_LABEL[check.checkType]} check · #${check.id}`}
      backLabel="Verification checks"
      onBack={onBack}
      statuses={
        <>
          <span className="adm-note">Check:</span> <StatusTag status={STATUS_TONE[check.status]} label={STATUS_LABEL[check.status]} />
        </>
      }
      actions={
        !decide ? null : check.status === "pending" ? (
          <>
            <AdminButton onClick={() => setDialog("info")}>Ask for more information</AdminButton>
            <AdminButton onClick={() => setDialog("reject")}>Decline</AdminButton>
            <AdminButton variant="primary" onClick={() => setDialog("approve")} disabled={!data.availability.available}>
              Approve
            </AdminButton>
          </>
        ) : check.status === "more_info" ? (
          <AdminButton onClick={() => setDialog("reject")}>Decline</AdminButton>
        ) : check.status === "approved" ? (
          <AdminButton variant="danger" onClick={() => setDialog("revoke")}>
            Withdraw check
          </AdminButton>
        ) : null
      }
      asideLabel="Who and what"
      aside={
        <>
          <ContextSection title={check.subjectType === "vendor" ? "Partner" : "Resident"}>
            <div className="wd-ctx-name">{subject?.name ?? "Account not found"}</div>
            {subject?.email && <div className="wd-ctx-sub">{subject.email}</div>}
            <DetailFacts columns={1} rows={[["Account ID", <CopyValue value={check.subjectId} label="account ID" />]]} />
          </ContextSection>
          <ContextSection title="Dates">
            <DetailFacts
              columns={1}
              rows={[
                ["Opened", formatDate(check.createdAt, true)],
                ["Last change", formatDate(check.updatedAt, true)],
                ["Decided", check.decidedAt ? formatDate(check.decidedAt, true) : "—"],
                ["Expires", check.expiresAt ? formatDate(check.expiresAt) : "Doesn't expire"],
              ]}
            />
          </ContextSection>
          <ContextSection title="What the public label says">
            <p className="adm-note">
              “Business details checked” — HelloCircle checked the business details against an official or public record. It doesn't cover staff, safeguarding or every activity. It shows only while this check is approved and unexpired.
            </p>
          </ContextSection>
        </>
      }
    >
      {!data.availability.available && (
        <p className="adm-note" role="status">
          {data.availability.why}
        </p>
      )}
      <DetailSection title="What they gave us">
        <p className="adm-review-text" style={{ whiteSpace: "pre-wrap" }}>{check.submittedDetails || <span className="adm-note">Nothing written.</span>}</p>
      </DetailSection>
      {check.infoRequest && (
        <DetailSection title="Information we asked for">
          <p className="adm-review-text">{check.infoRequest}</p>
        </DetailSection>
      )}
      <DetailSection title="What was checked (internal)">
        {data.evidenceRestricted ? (
          <p className="adm-note">Your admin role can't read evidence notes.</p>
        ) : check.evidenceNote ? (
          <p className="adm-review-text" style={{ whiteSpace: "pre-wrap" }}>{check.evidenceNote}</p>
        ) : (
          <p className="adm-note">No evidence note yet. It's written when the check is approved. HelloCircle doesn't store documents here.</p>
        )}
      </DetailSection>
      {check.decisionReason && (
        <DetailSection title="Reason given to the partner">
          <p className="adm-review-text">{check.decisionReason}</p>
        </DetailSection>
      )}
      <DetailSection title="Decisions">
        <DecisionHistory objectType="verification_check" objectId={String(check.id)} refreshKey={check.rowVersion} />
      </DetailSection>
      <DetailSection title="History">
        <ObjectActivity objectIds={[String(check.id)]} note="Every step on this check is recorded." />
      </DetailSection>

      <ConfirmDialog
        open={dialog === "info"}
        title="Ask for more information"
        message="The partner sees this message and can answer from their workspace. The check waits until they do."
        confirmLabel="Send request"
        tone="neutral"
        confirmDisabled={text.trim().length < 20}
        onConfirm={() => act(() => requestVerificationInfo(check.id, check.rowVersion, text.trim()), "Request sent")}
        onCancel={close}
      >
        <label className="adm-field">
          <span>What do you need? (at least 20 characters)</span>
          <textarea className="adm-input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {actionError && <p role="alert" className="adm-note" style={{ color: "var(--color-danger)" }}>{actionError}</p>}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "approve"}
        title="Approve this check?"
        message="Their public profile will show “Business details checked” with what it means. Record what you checked — it stays internal."
        confirmLabel="Approve check"
        tone="neutral"
        confirmDisabled={text.trim().length < 20}
        onConfirm={() => act(() => approveVerification(check.id, check.rowVersion, text.trim(), expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null), "Check approved")}
        onCancel={close}
      >
        <label className="adm-field">
          <span>What you checked, and against which record (internal, at least 20 characters)</span>
          <textarea className="adm-input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="adm-field">
          <span>Expires (optional)</span>
          <input className="adm-input" type="date" value={expires} min={irelandToday()} onChange={(e) => setExpires(e.target.value)} />
        </label>
        {actionError && <p role="alert" className="adm-note" style={{ color: "var(--color-danger)" }}>{actionError}</p>}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "reject" || dialog === "revoke"}
        title={dialog === "revoke" ? "Withdraw this check?" : "Decline this check?"}
        message={
          dialog === "revoke"
            ? "The label disappears from their profile straight away. They're told the reason and can ask for a new check later."
            : "They're told the reason category and your explanation, and can ask again once their details are right."
        }
        confirmLabel={dialog === "revoke" ? "Withdraw check" : "Decline check"}
        tone={dialog === "revoke" ? "danger" : "neutral"}
        confirmDisabled={!reasonComplete(reason)}
        onConfirm={() => act(() => declineVerification(check.id, check.rowVersion, dialog === "revoke" ? "revoke" : "reject", toReasonInput(reason)), dialog === "revoke" ? "Check withdrawn" : "Check declined")}
        onCancel={close}
      >
        <DecisionReasonFields kind="verification" audience="partner" value={reason} onChange={setReason} />
        {actionError && <p role="alert" className="adm-note" style={{ color: "var(--color-danger)" }}>{actionError}</p>}
      </ConfirmDialog>
    </RecordView>
  );
}

export function AdminVerificationPage() {
  const [view, setView] = useUrlParam<string>("view", "open");
  const state = useAdminData(() => fetchVerificationQueue(view as "open"), [view]);
  const [record, openRecord, closeRecord] = useRecordParam();
  const rows: VerificationListRow[] = state.data?.checks ?? [];
  const paged = usePaged(rows, 20, view, "page");

  if (record?.startsWith("check:")) {
    return <CheckRecord id={record.slice(6)} onBack={closeRecord} onChanged={state.reload} />;
  }

  return (
    <Box icon={BadgeCheck} title="Verification checks" subtitle="Business-details checks partners asked for, and their decisions. Labels show on profiles only while a check holds." flush>
      <ViewTabs
        label="Check status"
        value={view}
        onChange={setView}
        views={[
          { key: "open", label: "Open" },
          { key: "approved", label: "Approved" },
          { key: "all", label: "All" },
        ]}
      />
      <Loaded state={state}>
        {() =>
          rows.length === 0 ? (
            <EmptyMessage icon={<BadgeCheck size={22} strokeWidth={1.9} aria-hidden="true" />} title={view === "open" ? "No checks waiting" : "No checks here"} />
          ) : (
            <>
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Verification checks</caption>
                  <thead>
                    <tr>
                      <th scope="col">Who</th>
                      <th scope="col">Check</th>
                      <th scope="col">Status</th>
                      <th scope="col">Last change</th>
                      <th scope="col">
                        <span className="adm-visually-hidden">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.slice.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Who">
                          <div className="adm-cell-title">{r.subjectName ?? r.subjectId}</div>
                          <div className="adm-cell-sub">{r.subjectType === "vendor" ? "Partner" : "Resident"}</div>
                        </td>
                        <td data-label="Check">{CHECK_LABEL[r.checkType]}</td>
                        <td data-label="Status">
                          <StatusTag status={STATUS_TONE[r.status]} label={STATUS_LABEL[r.status]} />
                        </td>
                        <td data-label="Last change">{formatDate(r.updatedAt)}</td>
                        <td>
                          <AdminButton size="sm" onClick={() => openRecord(`check:${r.id}`)} aria-label={`Open the ${CHECK_LABEL[r.checkType].toLowerCase()} check for ${r.subjectName ?? r.subjectId}`}>
                            Open
                          </AdminButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager {...paged} noun="checks" />
            </>
          )
        }
      </Loaded>
      <Availability availability={state.data?.availability} />
    </Box>
  );
}

// --- attendance corrections -------------------------------------------------------

const CORRECTION_STATUS: Record<AttendanceCorrection["status"], string> = { open: "With the organiser", accepted: "Corrected", declined: "Declined by the organiser" };

/** Support can settle an attendance dispute the organiser declined (reached through the complaints process). */
export function AdminAttendanceCorrectionsPage() {
  const can = useAdminCan();
  const toast = useToast();
  const [view, setView] = useUrlParam<string>("view", "declined");
  const state = useAdminData(() => fetchAdminAttendanceCorrections(view === "all" ? undefined : (view as "open")), [view]);
  const rows = state.data ?? [];
  const paged = usePaged(rows, 20, view, "page");
  const [deciding, setDeciding] = useState<{ row: AttendanceCorrection; decision: "accept" | "decline" } | null>(null);
  const [note, setNote] = useState("");

  return (
    <Box icon={ClipboardCheck} title="Attendance corrections" subtitle="Participants asking for a missed or unrecorded visit to be corrected. Organisers decide first; support settles disputes." flush>
      <ViewTabs
        label="Request status"
        value={view}
        onChange={setView}
        views={[
          { key: "declined", label: "Declined" },
          { key: "open", label: "With the organiser" },
          { key: "accepted", label: "Corrected" },
          { key: "all", label: "All" },
        ]}
      />
      <Loaded state={state}>
        {() =>
          rows.length === 0 ? (
            <EmptyMessage icon={<ClipboardCheck size={22} strokeWidth={1.9} aria-hidden="true" />} title="No requests here" />
          ) : (
            <>
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Attendance corrections</caption>
                  <thead>
                    <tr>
                      <th scope="col">Place</th>
                      <th scope="col">Participant's note</th>
                      <th scope="col">Status</th>
                      <th scope="col">Asked</th>
                      <th scope="col">
                        <span className="adm-visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.slice.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Place">
                          <div className="adm-cell-title">{r.kind.replace("_", " ")}</div>
                          <div className="adm-cell-sub adm-mono">{r.ref}</div>
                        </td>
                        <td data-label="Participant's note">{r.note || <span className="adm-note">No note</span>}</td>
                        <td data-label="Status">
                          <StatusTag status={r.status === "accepted" ? "approved" : r.status === "declined" ? "rejected" : "pending"} label={CORRECTION_STATUS[r.status]} />
                          {r.decisionNote && <div className="adm-cell-sub">“{r.decisionNote}”</div>}
                        </td>
                        <td data-label="Asked">{formatDate(r.createdAt)}</td>
                        <td>
                          {can("complaints.handle") && r.status !== "accepted" && (
                            <div className="adm-cell-actions">
                              <AdminButton size="sm" onClick={() => setDeciding({ row: r, decision: "accept" })}>
                                Mark attended
                              </AdminButton>
                              {r.status === "open" && (
                                <AdminButton size="sm" onClick={() => setDeciding({ row: r, decision: "decline" })}>
                                  Decline
                                </AdminButton>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager {...paged} noun="requests" />
            </>
          )
        }
      </Loaded>
      <ConfirmDialog
        open={!!deciding}
        title={deciding?.decision === "accept" ? "Record this visit as attended?" : "Decline this request?"}
        message={
          deciding?.decision === "accept"
            ? "The attendance record becomes “present” (source: correction), so they can review the visit. Nothing about payment changes."
            : "The participant sees your note."
        }
        confirmLabel={deciding?.decision === "accept" ? "Mark attended" : "Decline"}
        tone="neutral"
        confirmDisabled={note.trim().length < 20}
        onConfirm={async () => {
          if (!deciding) return;
          await decideAdminAttendanceCorrection(deciding.row.id, deciding.decision, note.trim());
          toast.success(deciding.decision === "accept" ? "Attendance corrected" : "Request declined");
          setDeciding(null);
          setNote("");
          state.reload();
        }}
        onCancel={() => {
          setDeciding(null);
          setNote("");
        }}
      >
        <label className="adm-field">
          <span>Your reasons (the participant sees this; at least 20 characters)</span>
          <textarea className="adm-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </ConfirmDialog>
    </Box>
  );
}
