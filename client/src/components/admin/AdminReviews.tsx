import { useAdminCan } from "./adminPermissions";
import { useEffect, useState } from "react";
import { Flag, Star } from "lucide-react";
import { fetchAdminReviews, fetchModerationReports, fetchReportCase, hideReview, reinstateModeratedListing, resolveReport, unhideChatMessage, unhideReview } from "../../api";
import { DecisionReasonFields, emptyReason, reasonComplete, toReasonInput, type ReasonDraft } from "./DecisionReason";
import type { ModerationReport, ReportCase, Review } from "../../types";
import { ConfirmDialog } from "../ui";
import { useToast } from "../Toast";
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
  statusLabel,
  BulkBar,
  RowMenu,
  SelectAllHeader,
  SelectCell,
  useRowSelection,
} from "./adminUi";

// Reviews & reports (admin redesign 2026-10-14). Hide/unhide and the report
// decisions (dismiss / action / suspend, notes, statement of reasons) are
// the same API calls as before. GET /admin/reviews returns raw snake_case
// columns (SELECT *), so the old list printed "undefined · undefined" for
// the listing — read both spellings here rather than changing the API.

type AdminReview = Review & { hidden: number; listing_type?: string; listing_id?: string; created_at?: string };

const LISTING_TYPE: Record<string, string> = { centre: "Community centre", club: "Sports club", game: "Game", host: "Host", experience: "Experience", program: "Program" };

import { RecordState, RecordView } from "../workspace/RecordView";
import { ContextSection, CopyValue, DetailFacts, DetailSection, DetailStats } from "../workspace/DetailParts";
import { waitingLabel } from "./timeLabels";
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
  // Bulk hide / unhide: the same calls as each row's button, once per review.
  const canModerate = can("reviews.moderate");
  const sel = useRowSelection(canModerate ? paged.slice.map((r) => String(r.id)) : []);
  const chosen = rows.filter((r) => sel.has(String(r.id)));
  const toHide = chosen.filter((r) => !r.hidden);
  const toShow = chosen.filter((r) => !!r.hidden);
  const [bulk, setBulk] = useState<"hide" | "unhide" | null>(null);
  const toast = useToast();
  const runBulk = async () => {
    const list = bulk === "hide" ? toHide : toShow;
    let done = 0;
    for (const r of list) {
      try {
        await (bulk === "hide" ? hideReview(r.id) : unhideReview(r.id));
        done++;
      } catch {
        // counted below
      }
    }
    setBulk(null);
    sel.clear();
    state.reload();
    if (done === list.length) toast.success(`${done} review${done === 1 ? "" : "s"} ${bulk === "hide" ? "hidden" : "visible again"}`);
    else toast.error(`${done} of ${list.length} done; try the others one at a time.`);
  };

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
              <BulkBar sel={sel} noun="review">
                {toHide.length > 0 && (
                  <AdminButton variant="primary" size="sm" onClick={() => setBulk("hide")}>
                    Hide {toHide.length}
                  </AdminButton>
                )}
                {toShow.length > 0 && (
                  <AdminButton size="sm" onClick={() => setBulk("unhide")}>
                    Unhide {toShow.length}
                  </AdminButton>
                )}
              </BulkBar>
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Reviews</caption>
                  <thead>
                    <tr>
                      {canModerate && <SelectAllHeader sel={sel} label="Select all reviews on this page" />}
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
                          {canModerate && <SelectCell sel={sel} rowKey={String(r.id)} label={`Select review by ${r.name}`} />}
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
                              <RowMenu
                                name={`review by ${r.name}`}
                                items={canModerate ? [r.hidden ? { label: "Unhide", onSelect: () => act(r, false) } : { label: "Hide…", danger: true, onSelect: () => setConfirmHide(r) }] : []}
                                copy={{ label: "Copy listing reference", value: t.id }}
                              />
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
      <ConfirmDialog
        open={bulk !== null}
        title={bulk === "hide" ? `Hide ${toHide.length} review${toHide.length === 1 ? "" : "s"}?` : `Unhide ${toShow.length} review${toShow.length === 1 ? "" : "s"}?`}
        message={bulk === "hide" ? "They disappear from the public listing pages immediately. You can unhide them again later from this page." : "They show on the public listing pages again."}
        confirmLabel={bulk === "hide" ? `Hide ${toHide.length}` : `Unhide ${toShow.length}`}
        tone={bulk === "hide" ? undefined : "neutral"}
        onConfirm={runBulk}
        onCancel={() => setBulk(null)}
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
    case "circle_memory":
      return { label: "Remove memory", done: "Memory removed", impact: "Removes the photo or reflection from the Circle's Memories for everyone. The record stays for this case.", needsReason: true, audience: "applicant" };
    case "circle_plan":
      return { label: "Remove plan", done: "Plan removed", impact: "Takes the suggested plan down. Members are told why. Bookings on the listing it points at are not affected.", needsReason: true, audience: "applicant" };
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
    case "circle_memory":
      // The photo itself stays members-only (owner decision D4); the case shows the words around it.
      return [["Circle", v("circleName")], ["Kind", v("kind") === "photo" ? "Photo" : "Reflection"], ["Caption", v("caption")], ["Text", v("body")], ["Added by", v("authorName")], ["Status", v("status") === "removed" ? "Removed" : "Visible"]];
    case "circle_plan":
      return [["Circle", v("circleName")], ["Plan", v("title")], ["Note", v("note")], ["About", t.listingType ? `${v("listingType")} · ${v("listingId")}` : "Not linked to a listing"], ["Suggested by", v("authorName")], ["Status", v("status")]];
    case "program":
      return [["Programme", v("name")], ["Partner", v("partnerName")], ["Status", v("status")]];
    case "host":
      return [["Host", v("name")], ["Host status", v("hostStatus")]];
    case "provider":
      return [["Provider", v("name")], ["Account status", v("status")]];
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
      stats={
        <DetailStats
          items={[
            { label: pending ? "Open for" : "Status", value: pending ? (waitingLabel(report.createdAt) ?? "").replace("Waiting ", "") || "—" : statusLabel(report.status), sub: `Filed ${formatDate(report.createdAt)}` },
            { label: "Reported", value: statusLabel(report.targetType), sub: caseData.target ? "Still exists" : "No longer exists" },
            { label: "Other reports", value: String(caseData.relatedReports.length), sub: "On the same item" },
          ]}
        />
      }
      asideLabel="Case details and investigation notes"
      aside={
        <>
          <ContextSection title="Case details">
            <DetailFacts
              columns={1}
              rows={[
                ["Case", <CopyValue value={String(report.id)} label="case number" />],
                ["Status", pending ? "Open" : statusLabel(report.status)],
                ["Filed", formatDate(report.createdAt, true)],
                ["Target type", report.targetType],
                ["Target ID", <CopyValue value={report.targetId} label="target ID" />],
              ]}
            />
          </ContextSection>
          <ContextSection title="Investigation notes" action={<Visibility who="internal" />}>
            <label htmlFor="adm-report-notes" className="adm-visually-hidden">
              Investigation notes
            </label>
            <textarea id="adm-report-notes" className="adm-input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
            <div style={{ marginTop: 8 }}>
              <AdminButton size="sm" disabled={!canDecide || !!busy || notes === (report.adminNotes ?? "")} onClick={() => run("notes", () => resolveReport(reportId, { notes }), { success: "Notes saved" }).then((ok) => ok && load())}>
                {busy === "notes" ? "Saving…" : "Save notes"}
              </AdminButton>
            </div>
          </ContextSection>
        </>
      }
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
      <DetailSection title="Report">
        <p className="adm-review-text">{report.reason}</p>
      </DetailSection>
      <DetailSection title="Reported content">
        {caseData.target ? (
          <>
            <DetailFacts rows={targetFacts(report.targetType, caseData.target)} />
            <details className="adm-tech" style={{ marginTop: 12 }}>
              <summary>Record as stored</summary>
              <pre style={{ fontSize: 12, background: "var(--color-surface)", border: "1px solid var(--color-border)", padding: 10, overflowX: "auto", margin: "6px 0 0" }}>{JSON.stringify(caseData.target, null, 2)}</pre>
            </details>
          </>
        ) : (
          <p className="adm-note">The reported item no longer exists.</p>
        )}
      </DetailSection>
      {caseData.relatedReports.length > 0 && (
        <DetailSection title={`Other reports on this item (${caseData.relatedReports.length})`}>
          <ul className="wd-rows">
            {caseData.relatedReports.map((rr) => (
              <li key={rr.id}>
                <span className="wd-rows-main">{rr.reason}</span>
                <StatusTag status={rr.status} />
              </li>
            ))}
          </ul>
        </DetailSection>
      )}
      <DetailSection title="Activity">
        <ObjectActivity objectIds={[String(report.id)]} note="Decisions on reports are recorded." />
      </DetailSection>
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
  // Bulk dismiss: the case page's "Dismiss report", once per open report.
  const canDecide = useAdminCan()("reports.moderate");
  const sel = useRowSelection(canDecide ? paged.slice.filter((r) => r.status === "pending").map((r) => String(r.id)) : []);
  const [dismissing, setDismissing] = useState(false);
  const toast = useToast();
  const dismissSelected = async () => {
    const ids = [...sel.selected];
    let done = 0;
    for (const id of ids) {
      try {
        await resolveReport(Number(id), { status: "dismissed" });
        done++;
      } catch {
        // counted below
      }
    }
    setDismissing(false);
    sel.clear();
    state.reload();
    onCountsChanged?.();
    if (done === ids.length) toast.success(`${done} report${done === 1 ? "" : "s"} dismissed`);
    else toast.error(`${done} of ${ids.length} dismissed; open the others to see why.`);
  };

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
              <BulkBar sel={sel} noun="report">
                <AdminButton variant="primary" size="sm" onClick={() => setDismissing(true)}>
                  Dismiss {sel.count}
                </AdminButton>
              </BulkBar>
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Moderation reports</caption>
                  <thead>
                    <tr>
                      {canDecide && <SelectAllHeader sel={sel} label="Select all open reports on this page" />}
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
                        {canDecide && <SelectCell sel={sel} rowKey={String(r.id)} label={`Select report ${r.id}`} disabled={r.status !== "pending"} />}
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
                            <RowMenu name={`report ${r.id}`} items={[{ label: r.status === "pending" ? "Review case" : "View case", onSelect: () => setOpen(r) }]} copy={{ label: "Copy reported item reference", value: r.targetId }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager {...paged} noun="reports" />
              <ConfirmDialog
                open={dismissing}
                title={`Dismiss ${sel.count} report${sel.count === 1 ? "" : "s"}?`}
                message="Closes each report with no action on the reported item, the same as Dismiss report on a case page. No statement of reasons is recorded; open a case on its own to add one."
                confirmLabel={`Dismiss ${sel.count}`}
                tone="neutral"
                onConfirm={dismissSelected}
                onCancel={() => setDismissing(false)}
              />
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
