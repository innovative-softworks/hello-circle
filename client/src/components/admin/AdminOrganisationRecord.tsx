import { useState } from "react";
import { fetchAdminOrganisation, setOrganisationStatus } from "../../api";
import type { AdminOrganisationRecord } from "../../types";
import { useToast } from "../Toast";
import { ConfirmDialog } from "../ui";
import { RecordState, RecordView } from "../workspace/RecordView";
import { ObjectActivity } from "./AdminAudit";
import { DecisionHistory, DecisionReasonFields, emptyReason, reasonComplete, toReasonInput, type ReasonDraft } from "./DecisionReason";
import { useAdminCan } from "./adminPermissions";
import { AdminButton, Badge, Facts, SectionLabel, StatusTag, formatDate, useAdminData } from "./adminUi";

// D-01 — an organisation as a record page (?tab=organisations&record=org:<id>).
// Suspending an organisation covers every member and every listing it owns,
// whoever created it; suspending one person's account (Vendors) is separate.

const TYPE_LABEL: Record<string, string> = { centre: "Community centres", club: "Sports clubs", experience: "Experiences", programme: "Programmes" };
const LIVE: Record<string, string> = { centre: "approved", club: "approved", experience: "approved", programme: "published" };

export function OrganisationRecord({ orgId, backLabel, onBack, onOpenVendor, onChanged, flags }: { orgId: string; backLabel: string; onBack: () => void; onOpenVendor: (id: string) => void; onChanged: () => void; flags?: React.ReactNode }) {
  const state = useAdminData(() => fetchAdminOrganisation(orgId), [orgId]);
  const can = useAdminCan();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"suspend" | "reinstate" | null>(null);
  const [reason, setReason] = useState<ReasonDraft>(emptyReason);
  const [message, setMessage] = useState<ReasonDraft>(emptyReason);

  if (state.error && !state.data) return <RecordState state="error" backLabel={backLabel} onBack={onBack} onRetry={state.reload} />;
  if (!state.data) return <RecordState state="loading" backLabel={backLabel} onBack={onBack} />;
  const org: AdminOrganisationRecord = state.data;
  const suspended = org.status === "suspended";
  const live = org.listings.filter((l) => l.status === LIVE[l.type]).reduce((a, l) => a + l.n, 0);
  const members = org.members.length;

  // Errors are thrown so the dialog stays open with the typed reason.
  const suspend = async () => {
    await setOrganisationStatus(org.id, "suspended", toReasonInput(reason));
    toast.success(`${org.name} suspended — its members have been told why`);
    setConfirm(null);
    setReason(emptyReason());
    state.reload();
    onChanged();
  };
  const reinstate = async () => {
    await setOrganisationStatus(org.id, "active", toReasonInput(message));
    toast.success(`${org.name} reinstated`);
    setConfirm(null);
    setMessage(emptyReason());
    state.reload();
    onChanged();
  };

  return (
    <RecordView
      title={org.name}
      reference={
        <>
          Organisation · <span className="adm-mono">{org.id}</span>
        </>
      }
      backLabel={backLabel}
      onBack={onBack}
      statuses={
        <>
          <span className="adm-note">Organisation:</span> <StatusTag status={suspended ? "suspended" : "active"} label={suspended ? "Suspended" : "Active"} />
          {org.statusChangedAt && <span className="adm-note">since {formatDate(org.statusChangedAt, true)}</span>}
        </>
      }
      actions={
        can("orgs.suspend") ? (
          suspended ? (
            <AdminButton onClick={() => setConfirm("reinstate")}>Reinstate organisation</AdminButton>
          ) : (
            <AdminButton variant="danger" onClick={() => setConfirm("suspend")}>
              Suspend organisation
            </AdminButton>
          )
        ) : null
      }
    >
      {suspended && (
        <div className="adm-callout" role="status" style={{ marginBottom: 16 }}>
          Suspended: its listings are hidden and can't take new bookings, whichever member created them. Existing bookings are unchanged. Members can only see a read-only list of upcoming obligations.
        </div>
      )}
      <div className="adm-record-grid">
        <div>
          <SectionLabel>Members</SectionLabel>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {org.members.map((m) => (
              <li key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--adm-line, var(--color-border))" }}>
                <span style={{ fontWeight: 600 }}>{m.name || m.email}</span>
                <span className="adm-cell-sub">{m.email}</span>
                <Badge tone="outline">{m.invitedStaff ? (m.platformRole ?? "staff").replace(/_/g, " ") : "Owner"}</Badge>
                {m.status !== "approved" && <StatusTag status={m.status} label={m.status === "suspended" ? "Account suspended (individual)" : undefined} />}
                <AdminButton size="sm" onClick={() => onOpenVendor(m.id)}>
                  Open account
                </AdminButton>
              </li>
            ))}
            {members === 0 && <li className="adm-note">No members.</li>}
          </ul>
          <SectionLabel>Listings</SectionLabel>
          <Facts
            rows={Object.keys(TYPE_LABEL).map((t) => {
              const rows = org.listings.filter((l) => l.type === t);
              return [TYPE_LABEL[t], rows.length ? rows.map((r) => `${r.n} ${r.status}`).join(" · ") : "None"];
            })}
          />
          <p className="adm-note">Listing statuses never change when an organisation is suspended or reinstated.</p>
        </div>
        <div>
          <SectionLabel>Upcoming obligations</SectionLabel>
          <Facts
            rows={[
              ["Venue bookings", String(org.upcoming.bookings)],
              ["Club registrations", String(org.upcoming.registrations)],
              ["Programme enrolments", String(org.upcoming.enrolments)],
              ["Experience bookings", String(org.upcoming.experienceBookings)],
              ["Passes with credits left", String(org.upcoming.passes)],
            ]}
          />
          {flags}
        </div>
      </div>

      <SectionLabel>Decisions</SectionLabel>
      <DecisionHistory objectType="organisation" objectId={org.id} currentNeedsReason={suspended} refreshKey={org.status} />
      <SectionLabel>Activity</SectionLabel>
      <ObjectActivity objectIds={[org.id]} note="Suspensions, reinstatements and feature-flag changes are recorded." />

      <ConfirmDialog
        open={confirm === "suspend"}
        title={`Suspend ${org.name}?`}
        message={`This suspends the whole organisation — ${members} ${members === 1 ? "member" : "members"} and ${live} live ${live === 1 ? "listing" : "listings"}, whichever member created them. Its listings disappear from search, maps and links (a direct link says it isn't available) and nobody can book, register, enrol or buy a pass from it. Existing bookings stay as they are — nothing is cancelled or refunded (${org.upcoming.total} upcoming). A payment already in progress that completes is held for finance review, not confirmed. Members can sign in to a read-only list of upcoming obligations. Listing statuses aren't changed, so reinstating brings back exactly what was live. Every member is emailed the reason category and your explanation; the internal note isn't sent. This is different from suspending one person's account.`}
        confirmLabel="Suspend organisation"
        confirmDisabled={!reasonComplete(reason)}
        onConfirm={suspend}
        onCancel={() => setConfirm(null)}
      >
        <DecisionReasonFields kind="suspension" audience="partner" value={reason} onChange={setReason} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "reinstate"}
        title={`Reinstate ${org.name}?`}
        message="Its members get full workspace access again on their next action. Listings that were live before the suspension are public and bookable again; drafts, paused and rejected listings stay exactly as they are. Members are emailed that the organisation is reinstated, with your message if you add one. Payments held for review during the suspension stay in Finance until someone acts on them."
        confirmLabel="Reinstate organisation"
        tone="neutral"
        onConfirm={reinstate}
        onCancel={() => setConfirm(null)}
      >
        <DecisionReasonFields kind="suspension" audience="partner" value={message} onChange={setMessage} explanationOptional categoryless />
      </ConfirmDialog>
    </RecordView>
  );
}
