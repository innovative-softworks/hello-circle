import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Lock, SearchX } from "lucide-react";
import { AdminButton, LoadingRows, PageHeader } from "../admin/adminUi";
import { useRecordHeader } from "./WorkspaceShell";

// Dedicated record page inside a workspace tool (UI completion 2026-10-14) —
// replaces the old slide-in detail panels. The record lives in the URL
// (`?record=…` next to the list's own filter params), so it can be shared,
// refreshed and reached with Back/Forward, and "Back" returns to the list
// exactly as it was filtered. The record name is the page's single H1.

export function RecordView({
  title,
  reference,
  statuses,
  backLabel,
  onBack,
  actions,
  aside,
  asideLabel = "Details",
  stats,
  children,
}: {
  title: string;
  /** Reference shown under the title (an id, a booking ref). */
  reference?: ReactNode;
  /** Labelled status badges — one per concern (review, account, payment…). */
  statuses?: ReactNode;
  /** e.g. "All listings" — the list this record was opened from. */
  backLabel: string;
  onBack: () => void;
  /** Record actions for the current role and lifecycle state. */
  actions?: ReactNode;
  /** The context panel (ContextSections). With it the page is the 70/30
   * detail layout: header and content on the left, context on the right. */
  aside?: ReactNode;
  asideLabel?: string;
  /** Key numbers shown in a strip under the header (DetailStats). */
  stats?: ReactNode;
  children: ReactNode;
}) {
  const { workspaceLabel } = useRecordHeader();
  const headingWrap = useRef<HTMLDivElement>(null);
  // Moving into a record is a page change: put focus on its heading.
  useEffect(() => {
    const h1 = headingWrap.current?.querySelector<HTMLElement>("h1");
    if (h1) {
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
    }
  }, [title]);
  const head = (
    <>
      <AdminButton variant="quiet" size="sm" onClick={onBack} className="adm-record-back">
        <ArrowLeft size={16} strokeWidth={1.9} aria-hidden="true" /> Back to {backLabel.toLowerCase()}
      </AdminButton>
      <PageHeader
        title={title}
        subtitle={reference}
        crumbs={[{ label: workspaceLabel }, { label: backLabel, onClick: onBack }, { label: title }]}
        actions={actions}
      />
      {statuses && (
        <div className="adm-record-statuses" role="group" aria-label="Status">
          {statuses}
        </div>
      )}
      {stats}
    </>
  );
  if (aside) {
    return (
      <div className="adm-record wd" ref={headingWrap}>
        <div className="wd-layout">
          <div className="wd-main">
            {head}
            <div className="wd-body">{children}</div>
          </div>
          <aside className="wd-aside" aria-label={asideLabel}>
            <div className="wd-aside-inner">{aside}</div>
          </aside>
        </div>
      </div>
    );
  }
  return (
    <div className="adm-record" ref={headingWrap}>
      {head}
      {children}
    </div>
  );
}

/** Loading, missing, restricted and failed states for a record page. */
export function RecordState({
  state,
  backLabel,
  onBack,
  onRetry,
  message,
}: {
  state: "loading" | "missing" | "restricted" | "error";
  backLabel: string;
  onBack: () => void;
  onRetry?: () => void;
  message?: string;
}) {
  useRecordHeader();
  if (state === "loading") return <LoadingRows rows={6} label="Loading record" />;
  const Icon = state === "missing" ? SearchX : state === "restricted" ? Lock : AlertTriangle;
  const title = state === "missing" ? "This record doesn't exist or was removed" : state === "restricted" ? "You don't have access to this record" : "Couldn't load this record";
  return (
    <div className="adm-state" role={state === "error" ? "alert" : "status"}>
      <Icon size={22} strokeWidth={1.9} aria-hidden="true" />
      <h1 className="adm-state-title">{title}</h1>
      {message && <div>{message}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
        {state === "error" && onRetry && <AdminButton onClick={onRetry}>Try again</AdminButton>}
        <AdminButton variant={state === "error" ? "quiet" : "secondary"} onClick={onBack}>
          Back to {backLabel.toLowerCase()}
        </AdminButton>
      </div>
    </div>
  );
}
