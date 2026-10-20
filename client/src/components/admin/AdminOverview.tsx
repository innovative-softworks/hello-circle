import { detailIcon } from "../workspace/detailIcons";
import { useAdminCan } from "./adminPermissions";
import { ArrowRight, Award, Building2, ClipboardCheck, Compass, Flag, Gavel, Inbox, KeyRound, MapPin, MessageSquareWarning, Trophy, Wallet, Zap, type LucideIcon, ScrollText } from "lucide-react";
import {
  fetchAdminComplaints,
  fetchAdminListings,
  fetchAdminPlaceSuggestions,
  fetchAdminVendors,
  fetchAuditLog,
  fetchClaims,
  fetchDisputes,
  fetchHostApplications,
  fetchModerationReports,
  fetchPaymentReviews,
  fetchWebhookEvents,
} from "../../api";
import type { AdminStats, AuditEntry } from "../../types";
import { flattenListings, rowKey, vendorBlocksApproval } from "./AdminListings";
import type { AdminTab } from "./adminNav";
import { AuditList, type AuditSubject } from "./AdminAudit";
import { REVIEW_REASON } from "./FinanceRecords";
import { dueLabel, time, waitingLabel } from "./timeLabels";

export { dueLabel, waitingLabel };
import { AdminButton, Badge, Box, EmptyMessage, ErrorMessage, LoadingRows, useAdminData, type AdminData } from "./adminUi";

// Overview (admin redesign 2026-10-14; queue-first rework 2026-10-16).
// One queue of everything waiting for an admin, sorted by urgency: money
// with a deadline (held payment reviews, disputes needing a response) first,
// then everything else oldest first. Each source is only loaded when the
// admin's role can open it (D-02), so a missing permission never shows up as
// a "couldn't load" error. Totals sit in one quiet line under the queue.

type Urgency = "urgent" | "normal";

interface QueueItem {
  key: string;
  icon: LucideIcon;
  kind: string;
  title: string;
  detail: string;
  note?: string;
  urgency: Urgency;
  /** When the item started waiting (ISO). */
  since: string | null;
  /** A real deadline, when the item has one (ISO). */
  due?: string | null;
  dueLabel?: string;
  action: string;
  onOpen: () => void;
}

const TYPE_LABEL = { centre: "Community centre", club: "Sports club", experience: "Experience" } as const;
const TYPE_ICON = { centre: Building2, club: Trophy, experience: Compass } as const;
const ICON = { size: 18, strokeWidth: 1.9, "aria-hidden": true } as const;
const ORDER_LABEL: Record<string, string> = { booking: "Booking", registration: "Registration", program: "Programme enrolment", game: "Game place", experience: "Experience booking", pass: "Pass" };
const DISPUTE_OPEN = new Set(["needs_response", "warning_needs_response"]);

function settle<T>(s: AdminData<T | null>): T | null {
  return s.error ? null : s.data;
}

/** Urgent first (earliest deadline first, undated urgent after dated), then oldest first. */
export function sortQueue<T extends { urgency: Urgency; since: string | null; due?: string | null }>(items: T[]): T[] {
  const far = Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === "urgent" ? -1 : 1;
    if (a.urgency === "urgent") {
      const d = (time(a.due) ?? far) - (time(b.due) ?? far);
      if (d !== 0) return d;
    }
    return (time(a.since) ?? far) - (time(b.since) ?? far);
  });
}

export function AdminOverviewPage({
  stats,
  statsError,
  onNavigate,
  onOpenListing,
}: {
  stats: AdminStats | null;
  statsError: unknown;
  onNavigate: (tab: AdminTab, extra?: Record<string, string>) => void;
  onOpenListing: (key: string) => void;
}) {
  const can = useAdminCan();
  const allow = {
    listings: can("listings.view"),
    queues: can("queues.view"),
    reports: can("reports.view"),
    finance: can("finance.operate"),
    complaints: can("complaints.handle"),
    partners: can("partners.view"),
    audit: can("audit.view"),
  };
  // Each source resolves to null when the role can't open it ("not applicable").
  const gated = <T,>(ok: boolean, load: () => Promise<T>) => (ok ? load() : Promise.resolve(null));
  const listings = useAdminData(() => gated(allow.listings, fetchAdminListings), [allow.listings]);
  const claims = useAdminData(() => gated(allow.queues, fetchClaims), [allow.queues]);
  const hosts = useAdminData(() => gated(allow.queues, fetchHostApplications), [allow.queues]);
  const places = useAdminData(() => gated(allow.queues, () => fetchAdminPlaceSuggestions(false)), [allow.queues]);
  const reports = useAdminData(() => gated(allow.reports, () => fetchModerationReports(false)), [allow.reports]);
  const payReviews = useAdminData(() => gated(allow.finance, () => fetchPaymentReviews("open")), [allow.finance]);
  const disputes = useAdminData(() => gated(allow.finance, fetchDisputes), [allow.finance]);
  const parked = useAdminData(() => gated(allow.finance, () => fetchWebhookEvents("manual_review")), [allow.finance]);
  const complaints = useAdminData(() => gated(allow.complaints, () => fetchAdminComplaints()), [allow.complaints]);
  const vendors = useAdminData(() => gated(allow.partners, fetchAdminVendors), [allow.partners]);
  const audit = useAdminData(() => gated(allow.audit, fetchAuditLog), [allow.audit]);

  const sources = [listings, claims, hosts, places, reports, payReviews, disputes, parked, complaints];
  const queueLoading = sources.some((s) => s.loading && s.data === null && !s.error);
  const failed = sources.filter((s) => s.error).length;

  const listingRows = settle(listings) ? flattenListings(listings.data!) : [];
  const openDisputes = (settle(disputes) ?? []).filter((d) => DISPUTE_OPEN.has(d.status) || (d.status === "lost" && d.recovery_status === "pending"));
  const openComplaints = (settle(complaints) ?? []).filter((c) => c.status === "open" || c.status === "in_review");

  const queue = sortQueue<QueueItem>([
    ...(settle(payReviews) ?? []).map((r) => {
      const due = r.reviewHoldUntil ?? r.order?.reviewHoldUntil ?? null;
      const soon = r.urgency === "within_lead" || r.urgency === "after_start";
      return {
        key: `payreview:${r.id}`,
        icon: Wallet,
        kind: "Payment review",
        title: r.sourceType ? `${ORDER_LABEL[r.sourceType] ?? r.sourceType} ${r.sourceRef ?? ""}`.trim() : `Checkout ${r.checkoutSessionId.slice(-8)}`,
        detail: REVIEW_REASON[r.reason] ?? r.reason,
        note: soon ? (r.urgency === "after_start" ? "Activity has started" : "Starts soon") : undefined,
        urgency: "urgent" as const,
        since: r.flaggedAt,
        due: r.holdStatus === "held" ? due : null,
        dueLabel: r.holdStatus === "held" && due ? `Place held · ${dueLabel(due)}` : undefined,
        action: "Open",
        onOpen: () => onNavigate("finance", { section: "reviews", record: `review:${r.id}` }),
      };
    }),
    ...openDisputes.map((d) => {
      const respond = DISPUTE_OPEN.has(d.status);
      return {
        key: `dispute:${d.id}`,
        icon: Gavel,
        kind: "Dispute",
        title: d.source_type ? `${ORDER_LABEL[d.source_type] ?? d.source_type} ${d.source_ref ?? ""}`.trim() : "Unmatched payment",
        detail: `${(d.amount_minor / 100).toLocaleString("en-IE", { style: "currency", currency: (d.currency ?? "eur").toUpperCase() })} · ${d.reason.replace(/_/g, " ")}`,
        urgency: respond ? ("urgent" as const) : ("normal" as const),
        since: d.created_at ?? null,
        due: respond ? d.evidence_due_by : null,
        dueLabel: respond && d.evidence_due_by ? `Evidence due · ${dueLabel(d.evidence_due_by)}` : respond ? "Needs a response" : "Lost: decide who bears it",
        action: respond ? "Open" : "Decide",
        onOpen: () => onNavigate("finance", { section: "disputes", record: `dispute:${d.id}` }),
      };
    }),
    ...(settle(parked) ?? []).map((e) => ({
      key: `event:${e.id}`,
      icon: Zap,
      kind: "Payment event",
      title: e.eventType,
      detail: "Parked for a manual check. Nothing in it is marked paid.",
      urgency: "normal" as const,
      since: e.receivedAt,
      action: "Review",
      onOpen: () => onNavigate("finance", { section: "events", record: `event:${e.id}` }),
    })),
    ...listingRows
      .filter((r) => r.item.status === "pending")
      .map((r) => ({
        key: rowKey(r),
        icon: TYPE_ICON[r.type],
        kind: TYPE_LABEL[r.type],
        title: r.item.name,
        detail: [r.item.vendorName ?? r.item.vendorEmail ?? "No partner", [r.item.area, r.item.county].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
        note: vendorBlocksApproval(r.item) ? `Partner account ${r.item.vendorStatus}` : undefined,
        urgency: "normal" as const,
        since: r.item.createdAt ?? null,
        action: "Review",
        onOpen: () => onOpenListing(rowKey(r)),
      })),
    ...(settle(claims) ?? []).map((c) => ({
      key: `claim:${c.id}`,
      icon: KeyRound,
      kind: "Ownership claim",
      title: c.listingName,
      detail: `Claimed by ${c.vendorName}`,
      urgency: "normal" as const,
      since: c.createdAt,
      action: "Review",
      onOpen: () => onNavigate("claims", { record: `claim:${c.id}` }),
    })),
    ...(settle(hosts) ?? []).map((h) => ({
      key: `host:${h.id}`,
      icon: Award,
      kind: "Host application",
      title: h.name,
      detail: "Verified Host badge",
      urgency: "normal" as const,
      since: h.appliedAt,
      action: "Review",
      onOpen: () => onNavigate("hostApplications", { record: `host:${h.id}` }),
    })),
    ...(settle(places) ?? []).map((p) => ({
      key: `place:${p.id}`,
      icon: MapPin,
      kind: "Place suggestion",
      title: p.suggestedName,
      detail: [p.area, p.county].filter(Boolean).join(", ") || "No location given",
      urgency: "normal" as const,
      since: p.createdAt,
      action: "Review",
      onOpen: () => onNavigate("placeSuggestions", { record: `suggestion:${p.id}` }),
    })),
    ...(settle(reports) ?? []).map((r) => ({
      key: `report:${r.id}`,
      icon: Flag,
      kind: "User report",
      title: `Reported ${r.targetType.replace(/_/g, " ")}`,
      detail: `“${r.reason.length > 90 ? `${r.reason.slice(0, 90)}…` : r.reason}”`,
      urgency: "normal" as const,
      since: r.createdAt,
      action: "Open case",
      onOpen: () => onNavigate("reviews", { record: `report:${r.id}` }),
    })),
    ...openComplaints.map((c) => ({
      key: `complaint:${c.id}`,
      icon: MessageSquareWarning,
      kind: c.kind === "appeal" ? "Appeal" : "Complaint",
      title: `About a ${c.subjectType.replace(/_/g, " ")}${c.subjectRef ? ` (${c.subjectRef})` : ""}`,
      detail: c.status === "in_review" ? "In review" : `From ${c.email}`,
      urgency: "normal" as const,
      since: c.createdAt,
      action: "Open",
      onOpen: () => onNavigate("policies", { section: "complaints" }),
    })),
  ]);
  const SHOWN = 10;

  // --- names + links for the activity list (the audit log only stores ids) ---
  const listingById = new Map(listingRows.map((r) => [r.item.id, r]));
  const vendorById = new Map((settle(vendors) ?? []).map((v) => [v.id, v]));
  const resolve = (e: AuditEntry): AuditSubject | null => {
    const l = listingById.get(e.objectId);
    if (l && (e.objectType === "centre" || e.objectType === "club" || e.objectType === "experience")) {
      return { name: l.item.name, onOpen: () => onNavigate("listings", { record: rowKey(l) }) };
    }
    const v = vendorById.get(e.objectId);
    if (v && e.objectType === "user") return { name: v.name || v.email, onOpen: () => onNavigate("vendors", { record: v.id }) };
    return null;
  };

  const pendingListings = stats ? stats.centresPending + stats.clubsPending + (stats.experiencesPending ?? 0) : null;
  const newToday = stats?.newToday ?? stats?.bookingsToday;
  const failed7d = stats?.failedPayments7d;
  const due = queue.filter((q) => q.urgency === "urgent");
  const waiting = queue.filter((q) => q.urgency !== "urgent");
  // Urgent items are always shown; the rest fill up to SHOWN.
  const shownWaiting = waiting.slice(0, Math.max(SHOWN - due.length, 3));
  const hidden = waiting.length - shownWaiting.length;

  const cards: { key: string; icon: LucideIcon; label: string; hint: string; value: number | null; error?: boolean; onOpen?: () => void }[] = [
    { key: "all", icon: Inbox, label: "Waiting for a decision", hint: "All queues", value: queueLoading ? null : queue.length },
    ...(allow.listings ? [{ key: "listings", icon: ClipboardCheck, label: "Listings to review", hint: "Partner submissions", value: pendingListings, onOpen: () => onNavigate("pending") }] : []),
    ...(allow.reports ? [{ key: "reports", icon: Flag, label: "Open user reports", hint: "Reviews and circles", value: stats?.openReports ?? null, onOpen: () => onNavigate("reviews") }] : []),
    ...(allow.finance
      ? [
          { key: "payreviews", icon: Wallet, label: "Payment reviews", hint: "Places may be held", value: payReviews.data ? payReviews.data.length : null, error: !!payReviews.error, onOpen: () => onNavigate("finance", { section: "reviews" }) },
          { key: "disputes", icon: Gavel, label: "Disputes to act on", hint: "Response or recovery", value: disputes.data ? openDisputes.length : null, error: !!disputes.error, onOpen: () => onNavigate("finance", { section: "disputes" }) },
        ]
      : []),
  ];

  const row = (q: QueueItem) => {
    const Icon = q.icon;
    const wait = waitingLabel(q.since);
    return (
      <li key={q.key} className="adm-ov-row" data-urgent={q.urgency === "urgent" || undefined}>
        <span className="adm-ov-tile">
          <Icon {...ICON} />
        </span>
        <div className="adm-ov-main">
          <div className="adm-ov-title">{q.title}</div>
          <div className="adm-ov-detail">{q.detail}</div>
          {q.note && (
            <div style={{ marginTop: 4 }}>
              <Badge tone="warn">{q.note}</Badge>
            </div>
          )}
        </div>
        <div className="adm-ov-kind">{q.kind}</div>
        <div className="adm-ov-when">
          {q.dueLabel && <strong>{q.dueLabel}</strong>}
          {wait && <span>{wait}</span>}
        </div>
        <AdminButton size="sm" onClick={q.onOpen} aria-label={`${q.action}: ${q.kind.toLowerCase()} ${q.title}`}>
          {q.action}
        </AdminButton>
      </li>
    );
  };

  return (
    <div className="adm-stack adm-overview">
      {statsError ? (
        <Box>
          <ErrorMessage error={statsError} title="Couldn't load platform numbers" />
        </Box>
      ) : (
        <section aria-label="Needs attention" className="adm-ov-cards">
          {cards.map((c) => {
            const Icon = c.icon;
            const state = c.error ? "error" : c.value ? "hot" : c.value === 0 ? "cold" : undefined;
            const inner = (
              <>
                <span className="adm-ov-cardicon wd-ico" data-tone={detailIcon(c.label).tone}>
                  <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span className="adm-ov-cardvalue">{c.error ? "!" : c.value ?? "…"}</span>
                <span className="adm-ov-cardlabel">{c.label}</span>
                <span className="adm-ov-cardhint">{c.error ? "Couldn't load" : c.hint}</span>
              </>
            );
            return c.onOpen ? (
              <button key={c.key} type="button" className="adm-ov-card" data-state={state} onClick={c.onOpen} aria-label={`${c.label}: ${c.error ? "couldn't load" : c.value ?? "loading"}. Open`}>
                {inner}
              </button>
            ) : (
              <div key={c.key} className="adm-ov-card" data-state={state}>
                {inner}
              </div>
            );
          })}
        </section>
      )}

      <div className="adm-ov-queue">
        <Box
          icon={ClipboardCheck}
          title="Needs a decision"
          subtitle={queueLoading ? "Loading…" : queue.length === 0 ? "Nothing waiting" : "Deadlines first, then oldest first"}
          actions={queue.length > 0 ? <AdminButton variant="primary" onClick={() => queue[0].onOpen()}>Review next <ArrowRight size={18} strokeWidth={1.9} aria-hidden="true" /></AdminButton> : undefined}
          flush
        >
          {failed > 0 && (
            <div className="adm-callout" data-tone="error" role="alert" style={{ margin: "12px 24px" }}>
              {failed} of the queues couldn't be loaded, so this list may be incomplete.
            </div>
          )}
          {queueLoading && queue.length === 0 ? (
            <LoadingRows rows={4} label="Loading what's waiting" />
          ) : queue.length === 0 ? (
            <EmptyMessage icon={<ClipboardCheck size={22} strokeWidth={1.9} aria-hidden="true" />} title="All caught up" detail="Nothing is waiting for a decision." />
          ) : (
            <>
              {due.length > 0 && (
                <>
                  <h3 className="adm-ov-group">
                    Due soon <span>{due.length}</span>
                  </h3>
                  <ul className="adm-ov-list">{due.map(row)}</ul>
                </>
              )}
              {waiting.length > 0 && (
                <>
                  <h3 className="adm-ov-group">
                    Waiting <span>{waiting.length}</span>
                  </h3>
                  <ul className="adm-ov-list">{shownWaiting.map(row)}</ul>
                </>
              )}
              {hidden > 0 && <p className="adm-note adm-queue-more">{hidden} more waiting. Open each queue from the sidebar.</p>}
            </>
          )}
        </Box>
      </div>

      {!statsError && stats && (
        <section aria-label="Platform totals" className="adm-ov-totals">
          <div>
            <strong>{newToday ?? "…"}</strong>new bookings &amp; sign-ups today
          </div>
          <div data-tone={failed7d ? "alert" : undefined}>
            <strong>{failed7d ?? stats.paymentFailures}</strong>failed payments{failed7d === undefined ? " (all time)" : ", last 7 days"}
          </div>
          <div>
            <strong>{stats.totalListings}</strong>
            {stats.totalListings === 1 ? "listing" : "listings"}
          </div>
          <div>
            <strong>{stats.vendorCount}</strong>
            {stats.vendorCount === 1 ? "partner account" : "partner accounts"}
          </div>
          <div>
            <strong>{stats.reviewCount}</strong>
            {stats.reviewCount === 1 ? "review" : "reviews"}
          </div>
        </section>
      )}

      {allow.audit && (
        <Box icon={ScrollText} title="Recent activity" actions={<AdminButton size="sm" onClick={() => onNavigate("audit")}>Full audit log</AdminButton>} flush>
          {audit.error ? <ErrorMessage error={audit.error} onRetry={audit.reload} /> : audit.data === null ? <LoadingRows rows={3} /> : <AuditList entries={audit.data.slice(0, 5)} resolve={resolve} variant="timeline" />}
        </Box>
      )}
    </div>
  );
}
