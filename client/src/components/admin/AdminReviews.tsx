import { useAdminCan } from "./adminPermissions";
import { useEffect, useState } from "react";
import { Flag, Star } from "lucide-react";
import { fetchAdminReviews, fetchModerationReports, fetchReportCase, hideReview, reinstateModeratedListing, resolveReport, unhideChatMessage, unhideReview } from "../../api";
import { DecisionReasonFields, emptyReason, reasonComplete, toReasonInput, type ReasonDraft } from "./DecisionReason";
import type { ModerationReport, ReportCase, Review } from "../../types";
import { ConfirmDialog } from "../ui";
import {
  AdminButton,
  Badge,
  Box,
  EmptyMessage,
  ErrorMessage,
  Facts,
  Loaded,
  Pager,
  SearchField,
  SectionLabel,
  SelectField,
  StatusTag,
  Toolbar,
  ViewTabs,
  Visibility,
  formatDate,
  matches,
  useAdminAction,
  useAdminData,
  usePaged,
} from "./adminUi";

// Reviews & reports (admin redesign 2026-10-14). Hide/unhide and the report
// decisions (dismiss / action / suspend, notes, statement of reasons) are
// the same API calls as before. GET /admin/reviews returns raw snake_case
// columns (SELECT *), so the old list printed "undefined · undefined" for
// the listing — read both spellings here rather than changing the API.

type AdminReview = Review & { hidden: number; listing_type?: string; listing_id?: string; created_at?: string };

const LISTING_TYPE: Record<string, string> = { centre: "Community centre", club: "Sports club", game: "Game", host: "Host", experience: "Experience", program: "Program" };

import { RecordState, RecordView } from "../workspace/RecordView";
import { useRecordParam, useUrlParam } from "../../useUrlTab";
import { ObjectActivity } from "./AdminAudit";

function reviewTarget(r: AdminReview) {
  const type = r.listingType ?? r.listing_type ?? "";
  const id = r.listingId ?? r.listing_id ?? "";
  return { type, label: LISTING_TYPE[type] ?? type, id };
}

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} style={{ display: "inline-flex", gap: 1, color: "var(--color-gold)" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={13} strokeWidth={1.9} fill={n <= rating ? "currentColor" : "none"} aria-hidden="true" />
      ))}
    </span>
  );
}

function ReviewsBox() {
  const can = useAdminCan();
  const state = useAdminData(fetchAdminReviews as () => Promise<AdminReview[]>);
  const { run, busy } = useAdminAction();
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "visible" | "hidden">("all");
  const [rating, setRating] = useState("all");
  const [confirmHide, setConfirmHide] = useState<AdminReview | null>(null);
  const all = state.data ?? [];
  const base = all.filter((r) => (rating === "all" || String(r.rating) === rating) && matches(q, r.name, r.comment, reviewTarget(r).id));
  const rows = base.filter((r) => view === "all" || (view === "hidden" ? !!r.hidden : !r.hidden));
  const paged = usePaged(rows, 20, `${q}|${view}|${rating}`);
  const act = (r: AdminReview, hide: boolean) =>
    run(`${r.id}`, () => (hide ? hideReview(r.id) : unhideReview(r.id)), { success: hide ? "Review hidden" : "Review visible again" }).then((ok) => ok && state.reload());

  return (
    <Box icon={Star} title="Reviews" subtitle="Hidden reviews disappear from the public listing page immediately; you can restore them here." flush>
      <ViewTabs
        label="Review visibility"
        value={view}
        onChange={setView}
        views={[
          { key: "all", label: "All", count: state.data ? base.length : undefined },
          { key: "visible", label: "Visible", count: state.data ? base.filter((r) => !r.hidden).length : undefined },
          { key: "hidden", label: "Hidden", count: state.data ? base.filter((r) => !!r.hidden).length : undefined },
        ]}
      />
      <Toolbar label="Filter reviews">
        <SearchField label="Search reviews" value={q} onChange={setQ} placeholder="Reviewer, comment or listing reference" />
        <SelectField label="Rating" value={rating} onChange={setRating} options={[{ value: "all", label: "Any rating" }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} star${n === 1 ? "" : "s"}` }))]} />
      </Toolbar>
      <Loaded state={state}>
        {() =>
          rows.length === 0 ? (
            <EmptyMessage icon={<Star size={22} strokeWidth={1.9} aria-hidden="true" />} title={all.length ? "No reviews match" : "No reviews yet"} />
          ) : (
            <>
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Reviews</caption>
                  <thead>
                    <tr>
                      <th scope="col">Review</th>
                      <th scope="col">About</th>
                      <th scope="col">Date</th>
                      <th scope="col">Visibility</th>
                      <th scope="col">
                        <span className="adm-visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.slice.map((r) => {
                      const t = reviewTarget(r);
                      return (
                        <tr key={r.id}>
                          <td data-label="Review">
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span className="adm-cell-title">{r.name}</span>
                              <Stars rating={r.rating} />
                            </div>
                            {r.comment && <div style={{ fontSize: 13, marginTop: 3, maxWidth: 520 }}>{r.comment}</div>}
                          </td>
                          <td data-label="About">
                            <div>{t.label || "—"}</div>
                            <div className="adm-cell-sub adm-mono" title={t.id}>
                              {t.id.length > 14 ? `${t.id.slice(0, 8)}…` : t.id}
                            </div>
                          </td>
                          <td data-label="Date">{formatDate(r.createdAt ?? r.created_at)}</td>
                          <td data-label="Visibility">{r.hidden ? <Badge tone="bad">Hidden</Badge> : <Badge tone="good">Visible</Badge>}</td>
                          <td>
                            <div className="adm-cell-actions">
                              {!can("reviews.moderate") ? null : r.hidden ? (
                                <AdminButton size="sm" disabled={!!busy} onClick={() => act(r, false)} aria-label={`Unhide review by ${r.name}`}>
                                  Unhide
                                </AdminButton>
                              ) : (
                                <AdminButton size="sm" variant="danger" disabled={!!busy} onClick={() => setConfirmHide(r)} aria-label={`Hide review by ${r.name}`}>
                                  Hide
                                </AdminButton>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager {...paged} noun="reviews" />
            </>
          )
        }
      </Loaded>
      <ConfirmDialog
        open={!!confirmHide}
        title="Hide this review?"
        message="It disappears from the public listing page immediately. You can unhide it again later from this page."
        confirmLabel="Hide"
        onConfirm={() => {
          if (confirmHide) act(confirmHide, true);
          setConfirmHide(null);
        }}
        onCancel={() => setConfirmHide(null)}
      />
    </Box>
  );
}

// Report case page (was a slide-in panel) — loads by id, so `?record=report:<id>`
// works on its own (shared link, refresh). Stays open after a decision so the
// outcome is visible.
// OG-03 — what "suspend" does to each kind of reported content, and how it is
// undone. The server performs exactly this and refuses if nothing would change.
type Audience = "partner" | "applicant";
function suspendAction(type: string, t: Record<string, unknown> | null): { label: string; done: string; impact: string; needsReason: boolean; audience: Audience } | null {
  const n = (k: string) => Number(t?.[k] ?? 0);
  switch (type) {
    case "chat_message":
      return { label: "Hide message", done: "Message hidden", impact: "Hides the message for everyone in the chat. Its text stays stored for this case.", needsReason: true, audience: "applicant" };
    case "game":
      return {
        label: "Cancel activity",
        done: "Activity cancelled",
        impact: `Cancels the activity for everyone. ${n("joined")} ${n("joined") === 1 ? "person is" : "people are"} going${n("paidOnline") ? `; ${n("paidOnline")} paid online and will be refunded in full` : ""}. Participants, anyone waiting and the host are told.`,
        needsReason: true,
        audience: "applicant",
      };
    case "centre":
    case "club":
    case "experience":
      return { label: "Suspend listing", done: "Listing suspended", impact: "Hides the listing and closes it to new bookings. Existing bookings are kept. The partner is told why and can't resume it themselves.", needsReason: true, audience: "partner" };
    case "circle":
      return { label: "Close Circle", done: "Circle closed", impact: "Closes the Circle: its chat becomes read-only history.", needsReason: false, audience: "applicant" };
    case "review":
      return { label: "Hide review", done: "Review hidden", impact: "Hides the review from the listing page.", needsReason: false, audience: "applicant" };
    default:
      return null;
  }
}

function reversal(type: string, t: Record<string, unknown> | null): { label: string; done: string; impact: string } | null {
  if (type === "chat_message" && t?.hiddenAt) return { label: "Show message again", done: "Message shown again", impact: "The message becomes visible in the chat again." };
  if ((type === "centre" || type === "club" || type === "experience") && t?.status === "suspended") return { label: "Reinstate listing", done: "Listing reinstated", impact: "The listing returns to the status it had before it was suspended, and the partner is told." };
  return null;
}

function targetFacts(type: string, t: Record<string, unknown>): [string, React.ReactNode][] {
  const v = (k: string) => (t[k] === null || t[k] === undefined || t[k] === "" ? "—" : String(t[k]));
  switch (type) {
    case "chat_message":
      return [["Message", v("body")], ["Written by", v("authorName")], ["Chat", `${v("scopeType")} · ${v("scopeId")}`], ["Sent", formatDate(String(t.createdAt), true)], ["Hidden", t.hiddenAt ? `Yes — ${v("hiddenReason")}` : "No"]];
    case "game":
      return [["Activity", v("activityLabel")], ["When", `${v("date")} ${v("time")}`], ["Host", v("hostName")], ["Status", v("status")], ["Going", v("joined")], ["Paid online", v("paidOnline")]];
    case "centre":
    case "club":
    case "experience":
      return [["Listing", v("name")], ["Partner", v("partnerName")], ["Status", v("status")]];
    case "circle":
      return [["Circle", v("name")], ["Status", v("status")]];
    case "review":
      return [["Review", v("comment")], ["By", v("name")], ["Hidden", Number(t.hidden) ? "Yes" : "No"]];
    default:
      return [];
  }
}

function ReportCasePage({ reportId, onBack, onResolved }: { reportId: number; onBack: () => void; onResolved: () => void }) {
  const canDecide = useAdminCan()("reports.moderate");
  const [caseData, setCaseData] = useState<ReportCase | null>(null);
  const [caseError, setCaseError] = useState<unknown>(null);
  const [notes, setNotes] = useState("");
  const [reasons, setReasons] = useState("");
  const [confirming, setConfirming] = useState<"dismissed" | "actioned" | "suspended" | null>(null);
  const [reason, setReason] = useState<ReasonDraft>(emptyReason());
  const [reversing, setReversing] = useState(false);
  const [reverseNote, setReverseNote] = useState("");
  const { run, busy } = useAdminAction();

  const load = () => {
    setCaseError(null);
    fetchReportCase(reportId)
      .then((c) => {
        setCaseData(c);
        setNotes(c.report.adminNotes ?? "");
      })
      .catch(setCaseError);
  };
  useEffect(load, [reportId]);

  const resolve = (status: "dismissed" | "actioned" | "suspended") =>
    run(
      status,
      () => resolveReport(reportId, { status, statementOfReasons: reasons.trim() || undefined, ...(status === "suspended" && action?.needsReason ? toReasonInput(reason) : {}) }),
      {
        success: status === "dismissed" ? "Report dismissed" : status === "suspended" ? `${action?.done ?? "Content suspended"} and report closed` : "Report marked as actioned",
      }
    ).then((ok) => {
      if (ok) {
        setConfirming(null);
        setReasons("");
        setReason(emptyReason());
        onResolved();
        load();
      }
      return ok;
    });

  if (caseError && !caseData) {
    const status = (caseError as { status?: number })?.status;
    return <RecordState state={status === 404 ? "missing" : "error"} backLabel="Reviews & reports" onBack={onBack} onRetry={load} />;
  }
  if (!caseData) return <RecordState state="loading" backLabel="Reviews & reports" onBack={onBack} />;
  const report = caseData.report;
  const pending = report.status === "pending";
  const action = suspendAction(report.targetType, caseData.target);
  const reverse = reversal(report.targetType, caseData.target);

  return (
    <RecordView
      title={`Report on ${report.targetType} — case #${report.id}`}
      reference={<>Filed {formatDate(report.createdAt, true)}</>}
      backLabel="Reviews & reports"
      onBack={onBack}
      statuses={
        <>
          <span className="adm-note">Case:</span> <StatusTag status={report.status} label={pending ? "Open" : undefined} />
        </>
      }
      actions={
        pending && canDecide ? (
          <>
            <AdminButton disabled={!!busy} onClick={() => setConfirming("dismissed")}>
              Dismiss report
            </AdminButton>
            <AdminButton disabled={!!busy} onClick={() => setConfirming("actioned")}>
              Mark actioned
            </AdminButton>
            {action && (
              <AdminButton variant="danger" disabled={!!busy || !caseData.target} onClick={() => setConfirming("suspended")}>
                {action.label}
              </AdminButton>
            )}
          </>
        ) : reverse && canDecide ? (
          <AdminButton disabled={!!busy} onClick={() => setReversing(true)}>
            {reverse.label}
          </AdminButton>
        ) : undefined
      }
    >
      <div className="adm-record-grid">
        <div>
          <SectionLabel>Report</SectionLabel>
          <Facts
            rows={[
              ["Reason", report.reason],
              ["Filed", formatDate(report.createdAt, true)],
              ["Target", <span className="adm-mono">{report.targetType} · {report.targetId}</span>],
            ]}
          />
          <SectionLabel>Reported content</SectionLabel>
          {caseData.target ? (
            <>
            <Facts rows={targetFacts(report.targetType, caseData.target)} />
            <details className="adm-tech">
              <summary>Record as stored</summary>
              <pre style={{ fontSize: 12, background: "var(--color-surface)", border: "1px solid var(--color-border)", padding: 10, overflowX: "auto", margin: "6px 0 0" }}>{JSON.stringify(caseData.target, null, 2)}</pre>
            </details>
            </>
          ) : (
            <p className="adm-note">The reported item no longer exists.</p>
          )}
          {caseData.relatedReports.length > 0 && (
            <>
              <SectionLabel>Other reports on this item ({caseData.relatedReports.length})</SectionLabel>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {caseData.relatedReports.map((rr) => (
                  <li key={rr.id}>
                    {rr.reason} — {rr.status}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <SectionLabel>Investigation notes</SectionLabel>
          <div style={{ marginBottom: 6 }}>
            <Visibility who="internal" />
          </div>
          <label htmlFor="adm-report-notes" className="adm-visually-hidden">
            Investigation notes
          </label>
          <textarea id="adm-report-notes" className="adm-input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
          <div style={{ marginTop: 8 }}>
            <AdminButton size="sm" disabled={!canDecide || !!busy || notes === (report.adminNotes ?? "")} onClick={() => run("notes", () => resolveReport(reportId, { notes }), { success: "Notes saved" }).then((ok) => ok && load())}>
              {busy === "notes" ? "Saving…" : "Save notes"}
            </AdminButton>
          </div>
          <SectionLabel>Activity</SectionLabel>
          <ObjectActivity objectIds={[String(report.id)]} note="Decisions on reports are recorded." />
        </div>
      </div>
      <ConfirmDialog
        open={confirming !== null}
        title={confirming === "suspended" ? `${action?.label ?? "Suspend the content"}?` : confirming === "dismissed" ? "Dismiss this report?" : "Mark this report as actioned?"}
        message={
          <>
            <p style={{ margin: "0 0 10px" }}>
              {confirming === "suspended"
                ? action?.impact
                : confirming === "dismissed"
                  ? "Closes the report with no action on the reported item."
                  : "Marks it as actioned and removes it from the open queue. It doesn't change the reported item — use Suspend content for that."}
            </p>
            <label htmlFor="adm-report-reasons" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Statement of reasons <span style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea id="adm-report-reasons" className="adm-input" rows={3} value={reasons} onChange={(e) => setReasons(e.target.value)} placeholder="What was decided, the facts, and the rule relied on." style={{ width: "100%", resize: "vertical" }} />
            <p style={{ fontSize: 12.5, margin: "6px 0 0" }}>Recorded with the decision for appeals. It isn't currently shown to the reporter.</p>
            {confirming === "suspended" && action?.needsReason && <DecisionReasonFields kind="suspension" value={reason} onChange={setReason} audience={action.audience} />}
          </>
        }
        confirmDisabled={confirming === "suspended" && !!action?.needsReason && !reasonComplete(reason)}
        confirmLabel={confirming === "suspended" ? "Suspend content" : confirming === "dismissed" ? "Dismiss report" : "Mark actioned"}
        tone={confirming === "suspended" ? "danger" : "neutral"}
        onConfirm={() => {
          if (confirming) return resolve(confirming);
        }}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={reversing}
        title={`${reverse?.label ?? "Reverse"}?`}
        message={
          <>
            <p style={{ margin: "0 0 10px" }}>{reverse?.impact}</p>
            <label htmlFor="adm-report-reverse" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Reason <span aria-hidden="true">*</span>
            </label>
            <textarea id="adm-report-reverse" className="adm-input" rows={3} value={reverseNote} onChange={(e) => setReverseNote(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
          </>
        }
        confirmLabel={reverse?.label ?? "Reverse"}
        tone="neutral"
        confirmDisabled={reverseNote.trim().length < 5}
        onConfirm={() =>
          run(
            "reverse",
            () =>
              report.targetType === "chat_message"
                ? unhideChatMessage(report.targetId, reverseNote.trim())
                : reinstateModeratedListing(report.targetType as "centre" | "club" | "experience", report.targetId, { explanation: reverseNote.trim() }),
            { success: reverse?.done }
          ).then((ok) => {
            if (ok) {
              setReversing(false);
              setReverseNote("");
              load();
            }
            return ok;
          })
        }
        onCancel={() => setReversing(false)}
      />
    </RecordView>
  );
}

function ReportsBox({ onCountsChanged }: { onCountsChanged?: () => void }) {
  const [view, setView] = useUrlParam<"pending" | "all">("reports", "pending");
  const state = useAdminData(() => fetchModerationReports(view === "all"), [view]);
  const [, openRecord] = useRecordParam();
  const setOpen = (r: ModerationReport) => openRecord(`report:${r.id}`);
  const paged = usePaged(state.data ?? [], 20, view, "reportsPage");

  return (
    <Box icon={Flag} title="Reports" subtitle="User-submitted flags on reviews or circles. Open a case to see the reported item, related reports and notes, then decide." flush>
      <ViewTabs
        label="Report status"
        value={view}
        onChange={setView}
        views={[
          { key: "pending", label: "Open", count: view === "pending" && state.data ? state.data.length : undefined },
          { key: "all", label: "All, including resolved" },
        ]}
      />
      <Loaded state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyMessage icon={<Flag size={22} strokeWidth={1.9} aria-hidden="true" />} title={view === "pending" ? "No open reports" : "No reports yet"} />
          ) : (
            <>
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Moderation reports</caption>
                  <thead>
                    <tr>
                      <th scope="col">Reason</th>
                      <th scope="col">Reported item</th>
                      <th scope="col">Filed</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="adm-visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.slice.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Reason" style={{ maxWidth: 420 }}>{r.reason}</td>
                        <td data-label="Reported item">
                          <div style={{ textTransform: "capitalize" }}>{r.targetType}</div>
                          <div className="adm-cell-sub adm-mono">{r.targetId.length > 14 ? `${r.targetId.slice(0, 8)}…` : r.targetId}</div>
                        </td>
                        <td data-label="Filed">{formatDate(r.createdAt)}</td>
                        <td data-label="Status">
                          <StatusTag status={r.status} label={r.status === "pending" ? "Open" : undefined} />
                        </td>
                        <td>
                          <div className="adm-cell-actions">
                            <AdminButton size="sm" variant={r.status === "pending" ? "primary" : "secondary"} onClick={() => setOpen(r)}>
                              {r.status === "pending" ? "Review case" : "View case"}
                            </AdminButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager {...paged} noun="reports" />
            </>
          )
        }
      </Loaded>
    </Box>
  );
}

export function AdminReviewsPage({ onCountsChanged }: { onCountsChanged?: () => void }) {
  const [record, , closeRecord] = useRecordParam();
  const reportId = record?.startsWith("report:") ? Number(record.slice(7)) : null;
  if (reportId) return <ReportCasePage reportId={reportId} onBack={closeRecord} onResolved={() => onCountsChanged?.()} />;
  return (
    <div className="adm-stack">
      <ReportsBox onCountsChanged={onCountsChanged} />
      <ReviewsBox />
    </div>
  );
}
