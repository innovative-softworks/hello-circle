import { useState } from "react";
import { FileLock2, Search } from "lucide-react";
import { fetchConsentsForEmail, fetchPrivacyRequest, fetchPrivacyRequests, updatePrivacyRequest, type ConsentState, type ConsentSubjectView, type PrivacyRequestRow, type PrivacyStatus } from "../../api";
import { useUrlParam, useRecordParam } from "../../useUrlTab";
import { RecordState, RecordView } from "../workspace/RecordView";
import { ContextSection, CopyValue, DetailFacts, DetailSection, DetailStats } from "../workspace/DetailParts";
import { waitingLabel } from "./timeLabels";
import { useToast } from "../Toast";
import { RowMenu, AdminButton, Box, EmptyMessage, Facts, FormField, IconTabs, Loaded, SelectField, StatusTag, Toolbar, errorMessage, formatDate, useAdminData } from "./adminUi";

// OG-29 / OG-31 — the privacy-request queue and the consent viewer.
// Recording only: completing a request records the decision and emails the
// reply; nothing here deletes or anonymises data. Deletion waits on D-07 and
// on retention periods, which DEC-14 leaves unchosen.

const KIND_LABEL: Record<PrivacyRequestRow["kind"], string> = { access: "Copy of data", correction: "Correction", erasure: "Deletion", objection: "Objection" };
const STATUS_LABEL: Record<PrivacyStatus, string> = { received: "Received", in_progress: "In progress", completed: "Completed", refused: "Declined" };
const PURPOSE_LABEL: Record<string, string> = {
  privacy_notice_ack: "Privacy notice acknowledged",
  marketing_email: "Marketing email",
  analytics_cookies: "Analytics cookies",
  advertising_cookies: "Advertising cookies",
};
const tagStatus = (s: PrivacyStatus) => (s === "completed" ? "active" : s === "refused" ? "rejected" : "pending");

export function AdminPrivacyPage() {
  const [section, setSection] = useUrlParam<string>("psec", "requests");
  const [record, openRecord, closeRecord] = useRecordParam();
  const requestId = record?.startsWith("privacy:") ? Number(record.slice(8)) : null;
  if (requestId) return <PrivacyRequestRecord id={requestId} onBack={closeRecord} />;
  return (
    <div className="adm-stack">
      <IconTabs
        label="Privacy sections"
        value={section === "consents" ? "consents" : "requests"}
        onChange={(k) => setSection(k)}
        items={[
          { key: "requests", label: "Requests", icon: FileLock2 },
          { key: "consents", label: "Consent lookup", icon: Search },
        ]}
      />
      {section === "consents" ? <ConsentLookup /> : <PrivacyQueue onOpen={(id) => openRecord(`privacy:${id}`)} />}
    </div>
  );
}

function PrivacyQueue({ onOpen }: { onOpen: (id: number) => void }) {
  const [status, setStatus] = useUrlParam<string>("pstatus", "open");
  const state = useAdminData(() => fetchPrivacyRequests(status as "open"), [status]);
  return (
    <Box flush title="Privacy requests" subtitle="Requests people made from their account. Reply to each one; nothing is deleted automatically.">
      <Toolbar label="Filter requests">
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "open", label: "Open" },
            { value: "completed", label: "Completed" },
            { value: "refused", label: "Declined" },
            { value: "all", label: "All" },
          ]}
        />
      </Toolbar>
      <Loaded state={state} title="Couldn't load privacy requests">
        {(rows) =>
          rows.length === 0 ? (
            <EmptyMessage title={status === "open" ? "No open requests" : "No requests"} />
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--stack">
                <caption className="adm-visually-hidden">Privacy requests</caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Request</th>
                    <th scope="col">Received</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="adm-visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Person">
                        <strong>{r.name || r.email}</strong>
                        <div className="adm-note">
                          {r.email} · <span className="adm-mono">PR-{r.id}</span>
                        </div>
                      </td>
                      <td data-label="Request">{KIND_LABEL[r.kind]}</td>
                      <td data-label="Received">{formatDate(r.createdAt, true)}</td>
                      <td data-label="Status">
                        <StatusTag status={tagStatus(r.status)} label={STATUS_LABEL[r.status]} />
                      </td>
                      <td data-label="">
                        <div className="adm-cell-actions">
                          <AdminButton size="sm" onClick={() => onOpen(r.id)} aria-label={`Open request PR-${r.id}`}>
                            Open
                          </AdminButton>
                          <RowMenu name={`request PR-${r.id}`} items={[{ label: "Open", onSelect: () => onOpen(r.id) }]} copy={{ label: "Copy email", value: r.email }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
    </Box>
  );
}

function ConsentFacts({ current }: { current: Record<string, ConsentState> }) {
  return (
    <Facts
      rows={Object.entries(current).map(([purpose, c]) => [
        PURPOSE_LABEL[purpose] ?? purpose,
        c.at ? `${c.granted ? "Yes" : "No"} · ${formatDate(c.at, true)}${c.source ? ` · ${c.source}` : ""}${c.policyVersion ? ` · policy v${c.policyVersion}` : ""}` : "No record",
      ])}
    />
  );
}

function PrivacyRequestRecord({ id, onBack }: { id: number; onBack: () => void }) {
  const toast = useToast();
  const state = useAdminData(() => fetchPrivacyRequest(id), [id]);
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (state.error) return <RecordState state="error" backLabel="Privacy requests" onBack={onBack} onRetry={state.reload} message={errorMessage(state.error, "Couldn't load this request")} />;
  if (!state.data) return <RecordState state="loading" backLabel="Privacy requests" onBack={onBack} />;
  const r = state.data;
  const open = r.status === "received" || r.status === "in_progress";
  const erasure = r.kind === "erasure";
  const act = async (status: "in_progress" | "completed" | "refused", reply = false) => {
    if ((status !== "in_progress" || reply) && response.trim().length < 10) return setError("Write the reply the person will get (at least 10 characters)");
    setBusy(true);
    setError(null);
    try {
      await updatePrivacyRequest(id, { status, response: response.trim() || undefined });
      toast.success(status !== "in_progress" ? "Reply sent and request closed" : reply ? "Reply sent — the request stays open" : "Marked in progress");
      setResponse("");
      state.reload();
    } catch (e) {
      setError(errorMessage(e, "Couldn't update this request"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <RecordView
      title={`${KIND_LABEL[r.kind]} request`}
      reference={`From ${r.name || r.email} · received ${formatDate(r.createdAt)}`}
      statuses={<StatusTag status={tagStatus(r.status)} label={STATUS_LABEL[r.status]} />}
      backLabel="Privacy requests"
      onBack={onBack}
      stats={
        <DetailStats
          items={[
            { label: open ? "Open for" : "Closed", value: open ? (waitingLabel(r.createdAt) ?? "").replace("Waiting ", "") || "—" : STATUS_LABEL[r.status], sub: `Received ${formatDate(r.createdAt)}` },
            { label: "Request", value: KIND_LABEL[r.kind], sub: erasure ? "Can't be completed yet (D-07)" : undefined },
            { label: "Reply", value: r.response ? "Sent" : "Not sent", sub: r.response ? undefined : "Write it below" },
          ]}
        />
      }
      asideLabel="Requester and request details"
      aside={
        <>
          <ContextSection title="Requester">
            {r.name && <div className="wd-ctx-name">{r.name}</div>}
            <a className="wd-ctx-sub" href={`mailto:${r.email}`}>
              {r.email}
            </a>
          </ContextSection>
          <ContextSection title="Request details">
            <DetailFacts
              columns={1}
              rows={[
                ["Reference", <CopyValue value={`PR-${r.id}`} label="request reference" />],
                ["Received", formatDate(r.createdAt, true)],
              ]}
            />
          </ContextSection>
          {r.consents && (
            <ContextSection title="Their consent choices">
              <ConsentFacts current={r.consents} />
            </ContextSection>
          )}
        </>
      }
    >
      <DetailSection title="What they wrote">
        <p className="adm-review-text">{r.details || <span className="adm-note">Nothing added.</span>}</p>
        {r.kind === "erasure" && (
          <p className="adm-note" style={{ marginTop: 12 }}>
            Nothing can be deleted yet: deletion rules (D-07) and retention periods haven't been decided. So this request can't be marked completed — send your reply and keep it open, or decline it. The person sees it as still open.
          </p>
        )}
        {r.kind === "access" && (
          <p className="adm-note" style={{ marginTop: 12 }}>
            The person can download their own data any time from Profile → Your data.
          </p>
        )}
      </DetailSection>
      {r.response && (
        <DetailSection title="Reply sent">
          <p className="adm-review-text">{r.response}</p>
        </DetailSection>
      )}
      {open && (
        <DetailSection title="Reply">
          <FormField label="Reply to the person" hint={erasure ? "Emailed to them when you send it or decline the request." : "Emailed to them when you complete or decline the request."} error={error}>
            {(p) => <textarea {...p} rows={4} className="adm-input" value={response} onChange={(e) => setResponse(e.target.value)} style={{ resize: "vertical" }} />}
          </FormField>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            {erasure ? (
              <AdminButton variant="primary" disabled={busy} onClick={() => act("in_progress", true)}>
                Send reply, keep open
              </AdminButton>
            ) : (
              <AdminButton variant="primary" disabled={busy} onClick={() => act("completed")}>
                Complete and send
              </AdminButton>
            )}
            <AdminButton disabled={busy} onClick={() => act("refused")}>
              Decline and send
            </AdminButton>
            {r.status === "received" && (
              <AdminButton variant="quiet" disabled={busy} onClick={() => act("in_progress")}>
                Mark in progress
              </AdminButton>
            )}
          </div>
        </DetailSection>
      )}
    </RecordView>
  );
}

function ConsentLookup() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<ConsentSubjectView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const look = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await fetchConsentsForEmail(email.trim()));
    } catch (e) {
      setResult(null);
      setError(errorMessage(e, "Couldn't look that up"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="adm-stack">
      <Box title="Consent lookup" subtitle="The consent choices recorded for one email address, and their history.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void look();
          }}
          style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}
        >
          <FormField label="Email address" error={error}>
            {(p) => <input {...p} type="email" className="adm-input" style={{ minWidth: 260 }} value={email} onChange={(e) => setEmail(e.target.value)} />}
          </FormField>
          <AdminButton type="submit" variant="primary" disabled={busy || !email.trim()}>
            {busy ? "Looking…" : "Look up"}
          </AdminButton>
        </form>
      </Box>
      {result && result.length === 0 && <EmptyMessage title="No account with that email" />}
      {result?.map((s) => (
        <Box key={s.kind} title={`${s.name || "Unnamed"} · ${s.kind === "resident" ? "personal account" : s.kind === "partner" ? "partner account" : "admin account"}`}>
          <ConsentFacts current={s.current} />
          {s.history.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>History ({s.history.length})</summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13.5 }}>
                {s.history.map((h, i) => (
                  <li key={i}>
                    {formatDate(h.at, true)} · {PURPOSE_LABEL[h.purpose] ?? h.purpose}: {h.granted ? "yes" : "no"} · {h.source}
                    {h.policyVersion ? ` · policy v${h.policyVersion}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Box>
      ))}
    </div>
  );
}
