import { useAdminCan } from "./adminPermissions";
import { ArrowRight, Award, ClipboardCheck, Flag, KeyRound, LifeBuoy, List, MapPin, ScrollText, Store } from "lucide-react";
import type { ReactNode } from "react";
import { fetchAdminListings, fetchAdminPlaceSuggestions, fetchAuditLog, fetchClaims, fetchHostApplications, fetchModerationReports, fetchWebhookEvents } from "../../api";
import { useAuth } from "../../AuthContext";
import type { AdminStats } from "../../types";
import { flattenListings, rowKey, vendorBlocksApproval } from "./AdminListings";
import type { AdminTab } from "./adminNav";
import { AuditList } from "./AdminAudit";
import { AdminButton, Badge, Box, EmptyMessage, ErrorMessage, LoadingRows, Metric, MetricStrip, formatDate, useAdminData, type AdminData } from "./adminUi";

// Overview (admin redesign 2026-10-14). Every number is from a live
// endpoint and says what window it covers; the queue lists the actual items
// waiting (not just counts) and links straight to their review screens.

interface QueueItem {
  key: string;
  kind: string;
  title: string;
  detail: string;
  note?: string;
  onOpen: () => void;
}

const TYPE_LABEL = { centre: "Community centre", club: "Sports club", experience: "Experience" } as const;

function settle<T>(s: AdminData<T>): T | null {
  return s.error ? null : s.data;
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
  const listings = useAdminData(fetchAdminListings);
  const claims = useAdminData(fetchClaims);
  const hosts = useAdminData(fetchHostApplications);
  const places = useAdminData(() => fetchAdminPlaceSuggestions(false));
  const reports = useAdminData(() => fetchModerationReports(false));
  const audit = useAdminData(fetchAuditLog);
  // Payment events parked for review (finance/super only — the server refuses others).
  const financeRole = useAdminCan()("finance.operate");
  const parked = useAdminData(() => (financeRole ? fetchWebhookEvents("manual_review") : Promise.resolve(null)), [financeRole]);

  const sources = [listings, claims, hosts, places, reports];
  const queueLoading = sources.some((s) => s.data === null && !s.error);
  const failed = sources.filter((s) => s.error).length;

  const queue: QueueItem[] = [
    ...(settle(listings) ? flattenListings(listings.data!).filter((r) => r.item.status === "pending") : []).map((r) => ({
      key: rowKey(r),
      kind: TYPE_LABEL[r.type],
      title: r.item.name,
      detail: r.item.vendorName ?? r.item.vendorEmail ?? "No partner",
      note: vendorBlocksApproval(r.item) ? `Partner account ${r.item.vendorStatus}` : undefined,
      onOpen: () => onOpenListing(rowKey(r)),
    })),
    ...(settle(claims) ?? []).map((c) => ({ key: `claim:${c.id}`, kind: "Ownership claim", title: c.listingName, detail: `${c.vendorName} · ${formatDate(c.createdAt)}`, onOpen: () => onNavigate("claims", { record: `claim:${c.id}` }) })),
    ...(settle(hosts) ?? []).map((h) => ({ key: `host:${h.id}`, kind: "Host application", title: h.name, detail: `Applied ${formatDate(h.appliedAt)}`, onOpen: () => onNavigate("hostApplications", { record: `host:${h.id}` }) })),
    ...(settle(places) ?? []).map((p) => ({ key: `place:${p.id}`, kind: "Place suggestion", title: p.suggestedName, detail: [p.area, p.county].filter(Boolean).join(", ") || "No location", onOpen: () => onNavigate("placeSuggestions", { record: `suggestion:${p.id}` }) })),
    ...(settle(reports) ?? []).map((r) => ({ key: `report:${r.id}`, kind: "User report", title: r.reason, detail: `On a ${r.targetType} · ${formatDate(r.createdAt)}`, onOpen: () => onNavigate("reviews", { record: `report:${r.id}` }) })),
  ];
  const SHOWN = 8;

  const pendingListings = stats ? stats.centresPending + stats.clubsPending + (stats.experiencesPending ?? 0) : null;

  const quick: { tab: AdminTab; label: string; icon: ReactNode }[] = [
    { tab: "pending", label: "Pending approvals", icon: <ClipboardCheck size={18} strokeWidth={1.9} aria-hidden="true" /> },
    { tab: "listings", label: "All listings", icon: <List size={18} strokeWidth={1.9} aria-hidden="true" /> },
    { tab: "vendors", label: "Vendors", icon: <Store size={18} strokeWidth={1.9} aria-hidden="true" /> },
    { tab: "claims", label: "Claims", icon: <KeyRound size={18} strokeWidth={1.9} aria-hidden="true" /> },
    { tab: "hostApplications", label: "Host applications", icon: <Award size={18} strokeWidth={1.9} aria-hidden="true" /> },
    { tab: "placeSuggestions", label: "Place suggestions", icon: <MapPin size={18} strokeWidth={1.9} aria-hidden="true" /> },
    { tab: "reviews", label: "Reviews & reports", icon: <Flag size={18} strokeWidth={1.9} aria-hidden="true" /> },
    { tab: "support", label: "Support lookup", icon: <LifeBuoy size={18} strokeWidth={1.9} aria-hidden="true" /> },
    { tab: "audit", label: "Audit log", icon: <ScrollText size={18} strokeWidth={1.9} aria-hidden="true" /> },
  ];

  return (
    <div className="adm-stack">
      {statsError ? (
        <Box>
          <ErrorMessage error={statsError} title="Couldn't load platform metrics" />
        </Box>
      ) : (
        <MetricStrip label="Platform metrics">
          <Metric label="Listings awaiting review" value={pendingListings ?? "—"} period="Right now" tone={pendingListings ? "alert" : undefined} action={pendingListings ? { label: "Review queue", onClick: () => onNavigate("pending") } : undefined} />
          <Metric label="Open user reports" value={stats?.openReports ?? "—"} period="Right now" tone={stats?.openReports ? "alert" : undefined} action={stats?.openReports ? { label: "Open reports", onClick: () => onNavigate("reviews") } : undefined} />
          <Metric label="New bookings & registrations" value={stats?.bookingsToday ?? "—"} period="Today (server date) · hall bookings + club registrations" />
          <Metric label="Failed payments" value={stats?.paymentFailures ?? "—"} period="All time · bookings + registrations" tone={stats?.paymentFailures ? "alert" : undefined} />
          {financeRole && (
            <Metric
              label="Payment events needing review"
              value={parked.error ? "Couldn't load" : parked.data ? parked.data.length : "—"}
              period="Right now · nothing in these is marked paid"
              tone={parked.data?.length || parked.error ? "alert" : undefined}
              action={parked.data?.length ? { label: "Review events", onClick: () => onNavigate("finance", { section: "events" }) } : undefined}
            />
          )}
          <Metric label="Listings on the platform" value={stats?.totalListings ?? "—"} period="All time · excludes drafts and deleted" action={{ label: "All listings", onClick: () => onNavigate("listings") }} />
          <Metric label="Partner accounts" value={stats?.vendorCount ?? "—"} period="All time · any status" action={{ label: "Vendors", onClick: () => onNavigate("vendors") }} />
          <Metric label="Reviews" value={stats?.reviewCount ?? "—"} period="All time · includes hidden" />
        </MetricStrip>
      )}

      <div className="adm-grid-2">
        <Box
          title="Needs a decision"
          subtitle={queueLoading ? "Loading…" : `${queue.length} item${queue.length === 1 ? "" : "s"} waiting across listings, claims, hosts, places and reports`}
          actions={queue.length > 0 ? <AdminButton variant="primary" onClick={() => queue[0].onOpen()}>Review next <ArrowRight size={18} strokeWidth={1.9} aria-hidden="true" /></AdminButton> : undefined}
          flush
        >
          {failed > 0 && (
            <div className="adm-callout" data-tone="error" role="alert" style={{ margin: "12px 18px 0" }}>
              {failed} of 5 queues couldn't be loaded, so this list may be incomplete.
            </div>
          )}
          {queueLoading ? (
            <LoadingRows rows={4} label="Loading approval queue" />
          ) : queue.length === 0 ? (
            <EmptyMessage icon={<ClipboardCheck size={22} strokeWidth={1.9} aria-hidden="true" />} title="All caught up" detail="Nothing is waiting for a decision." />
          ) : (
            <>
              <ul className="adm-queue">
                {queue.slice(0, SHOWN).map((q) => (
                  <li key={q.key}>
                    <div className="adm-queue-main">
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Badge tone="outline">{q.kind}</Badge>
                        {q.note && <Badge tone="warn">{q.note}</Badge>}
                      </div>
                      <div className="adm-cell-title" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {q.title}
                      </div>
                      <div className="adm-cell-sub">{q.detail}</div>
                    </div>
                    <AdminButton size="sm" onClick={q.onOpen} aria-label={`Review ${q.kind.toLowerCase()}: ${q.title}`}>
                      Review
                    </AdminButton>
                  </li>
                ))}
              </ul>
              {queue.length > SHOWN && (
                <p className="adm-note" style={{ padding: "10px 18px", borderTop: "1px solid var(--color-border)" }}>
                  {queue.length - SHOWN} more — open each queue from the sidebar or the quick links.
                </p>
              )}
            </>
          )}
        </Box>

        <Box title="Quick links" flush>
          <div className="adm-quick">
            {quick.map((l) => (
              <button key={l.tab} type="button" onClick={() => onNavigate(l.tab)}>
                {l.icon}
                {l.label}
              </button>
            ))}
          </div>
        </Box>
      </div>

      <Box title="Recent activity" subtitle="Latest admin and system actions from the audit log" actions={<AdminButton size="sm" onClick={() => onNavigate("audit")}>Full audit log</AdminButton>} flush>
        {audit.error ? <ErrorMessage error={audit.error} onRetry={audit.reload} /> : audit.data === null ? <LoadingRows rows={3} /> : <AuditList entries={audit.data.slice(0, 6)} />}
      </Box>
    </div>
  );
}
