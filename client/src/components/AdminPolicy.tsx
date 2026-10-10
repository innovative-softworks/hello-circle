import { useEffect, useState, type CSSProperties } from "react";
import {
  createPolicyDraft,
  decideComplaint,
  fetchAdminComplaints,
  fetchAdminPolicies,
  fetchAdminTraders,
  fetchPolicyVersions,
  policyTransition,
  previewPolicyVersion,
  savePolicyDraft,
  setPolicyPlaceholder,
  verifyTrader,
  type AdminComplaint,
  type AdminPolicyOverview,
  type AdminPolicyPreview,
  type AdminPolicyVersion,
  type AdminTrader,
  type PolicyAction,
} from "../api";
import { useAuth } from "../AuthContext";
import { colors, fonts, radius } from "../theme";
import { PolicyMarkdown } from "./PolicyMarkdown";
import { Button, ManageCard as Card, Modal, inputStyle, labelStyle, tableStyle, tdStyle, thStyle } from "./ui";

// Revenue & Connect Stage 4 — admin "Policies & trust": the policy CMS
// (legal), placeholder values (legal), complaints/appeals (support) and
// trader verification (legal/support). The server enforces every gate; this
// UI only hides what the role can't use. Every write asks for a reason.

const h3: CSSProperties = { fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 6px" };
const hint: CSSProperties = { fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px", lineHeight: 1.5 };
const errStyle: CSSProperties = { color: colors.danger, fontSize: 13, background: colors.dangerBg, padding: "8px 12px", borderRadius: radius.control, margin: "10px 0 0" };
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", dateStyle: "medium", timeStyle: "short" }) : "—");
const DRAFT_BANNER = "Draft — legal review required";

const STATUS_TONE: Record<string, string> = { draft: colors.orangeDark, review: colors.orangeDark, approved: colors.greenText, published: colors.greenText, retired: colors.mutedLight };

// --- documents --------------------------------------------------------------------------

function VersionEditor({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const [v, setV] = useState<AdminPolicyPreview | null>(null);
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [material, setMaterial] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [reason, setReason] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [effective, setEffective] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canSignOff = (user?.adminRole ?? "super") === "legal" || (user?.adminRole ?? "super") === "super";

  const load = () =>
    previewPolicyVersion(id).then((p) => {
      setV(p);
      setBody(p.body);
      setSummary(p.changeSummary ?? "");
      setMaterial(p.material === 1);
    });
  useEffect(() => {
    load();
  }, [id]);

  if (!v) return null;
  const editable = v.status === "draft";
  const dirty = editable && (body !== v.body || summary !== (v.changeSummary ?? "") || material !== (v.material === 1));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  const act = (action: PolicyAction, extra: Record<string, unknown> = {}) => run(() => policyTransition(v.id, action, { reason, ...extra }));
  const reasonOk = reason.trim().length >= 5;

  return (
    <Modal open size="wide" onClose={onClose} title={`${v.docKey} — version ${v.version}`} subtitle={`Status: ${v.status}${v.legalReviewedAt ? ` · legal sign-off by ${v.legalReviewerName} (${when(v.legalReviewedAt)})` : ""}`}>
      {v.status !== "published" && v.status !== "retired" && (
        <p role="status" style={{ background: colors.orangeBg, color: colors.orangeDark, fontWeight: 700, padding: "8px 12px", borderRadius: radius.control, fontSize: 13.5, margin: "0 0 12px" }}>
          {DRAFT_BANNER}
        </p>
      )}
      <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["edit", "preview"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} style={{ border: `1px solid ${view === k ? colors.green : colors.border}`, background: view === k ? colors.greenBg : "transparent", borderRadius: 999, padding: "5px 12px", fontSize: 13, cursor: "pointer" }}>
            {k === "edit" ? (editable ? "Edit" : "Source") : "Preview"}
          </button>
        ))}
      </div>
      {view === "edit" ? (
        <textarea aria-label="Policy text (Markdown)" rows={22} value={body} readOnly={!editable} onChange={(e) => setBody(e.target.value)} style={{ ...inputStyle, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, resize: "vertical" }} />
      ) : (
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "16px 18px", maxHeight: 520, overflowY: "auto" }}>
          <PolicyMarkdown source={v.rendered} />
        </div>
      )}
      {editable && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "end", marginTop: 10 }}>
          <label>
            <span style={labelStyle}>Summary of changes (shown in the public history)</span>
            <input value={summary} onChange={(e) => setSummary(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, paddingBottom: 10 }}>
            <input type="checkbox" checked={material} onChange={(e) => setMaterial(e.target.checked)} /> Material change (ask users to re-accept)
          </label>
          <Button disabled={!dirty || busy} onClick={() => run(() => savePolicyDraft(v.id, { body, changeSummary: summary, material, rowVersion: v.rowVersion }))}>Save draft</Button>
        </div>
      )}
      <div style={{ marginTop: 14, padding: 12, background: colors.panel, borderRadius: radius.control, fontSize: 13 }}>
        <strong>Before this can be published</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
          <li style={{ color: v.blockers.placeholders.length ? colors.danger : colors.greenText }}>
            {v.blockers.placeholders.length ? `Placeholders without a value: ${v.blockers.placeholders.join(", ")}` : "All placeholders have values"}
          </li>
          <li style={{ color: v.blockers.notes.length ? colors.danger : colors.greenText }}>
            {v.blockers.notes.length ? `${v.blockers.notes.length} editorial note(s) in [square brackets] still in the text` : "No editorial notes left"}
          </li>
          <li style={{ color: v.blockers.legalReview ? colors.danger : colors.greenText }}>{v.blockers.legalReview ? "Legal sign-off not yet recorded" : "Legal sign-off recorded"}</li>
        </ul>
      </div>
      {v.status !== "published" && v.status !== "retired" && (
        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <label>
            <span style={labelStyle}>Reason (required for every step, audited)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            {v.status === "draft" && (
              <>
                <Button disabled={!reasonOk || busy || dirty} onClick={() => act("submit")}>Send for review</Button>
                <Button variant="danger" disabled={!reasonOk || busy} onClick={() => act("discard").then(onClose)}>Discard draft</Button>
              </>
            )}
            {v.status === "review" && (
              <>
                <Button disabled={!reasonOk || busy} onClick={() => act("approve")}>Approve</Button>
                <Button variant="ghost" disabled={!reasonOk || busy} onClick={() => act("reject")}>Back to draft</Button>
              </>
            )}
            {v.status === "approved" && (
              <>
                {canSignOff && !v.legalReviewedAt && (
                  <>
                    <label>
                      <span style={labelStyle}>Legal reviewer's name</span>
                      <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} style={inputStyle} />
                    </label>
                    <Button disabled={!reasonOk || busy || reviewer.trim().length < 3} onClick={() => act("legal_signoff", { reviewerName: reviewer.trim() })}>Record legal sign-off</Button>
                  </>
                )}
                <label>
                  <span style={labelStyle}>Effective from (optional)</span>
                  <input type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} style={inputStyle} />
                </label>
                <Button disabled={!reasonOk || busy} onClick={() => act("publish", { effectiveFrom: effective ? new Date(effective).toISOString() : undefined, material })}>Publish</Button>
                <Button variant="ghost" disabled={!reasonOk || busy} onClick={() => act("reject")}>Back to draft</Button>
              </>
            )}
          </div>
        </div>
      )}
      {v.contentHash && <p style={{ ...hint, marginTop: 12, wordBreak: "break-all" }}>Published text SHA-256: {v.contentHash}</p>}
      {error && <p role="alert" style={errStyle}>{error}</p>}
    </Modal>
  );
}

function DocumentsSection({ overview, reload }: { overview: AdminPolicyOverview; reload: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [versions, setVersions] = useState<AdminPolicyVersion[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadVersions = (key: string) => fetchPolicyVersions(key).then(setVersions);

  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Policy documents</h3>
      <p style={hint}>
        Every document starts as a structured draft marked "{DRAFT_BANNER}". A version is published only after review, approval, a named legal sign-off, values for every placeholder and no remaining editorial notes. Until a document is
        published, the public site shows "being prepared" (and the existing Privacy and Cookie pages stay in place).
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Document</th><th style={thStyle}>Latest</th><th style={thStyle}>Published</th><th style={thStyle}>Acceptance</th><th style={thStyle} /></tr></thead>
          <tbody>
            {overview.documents.map((d) => (
              <tr key={d.docKey}>
                <td style={tdStyle}>{d.title}<div style={{ fontSize: 12, color: colors.mutedLight }}>{d.docKey}</div></td>
                <td style={{ ...tdStyle, color: STATUS_TONE[d.latestStatus] ?? colors.text, fontWeight: 600 }}>v{d.latestVersion} {d.latestStatus}</td>
                <td style={tdStyle}>{d.publishedVersion ? `v${d.publishedVersion} · ${when(d.publishedAt)}` : "—"}</td>
                <td style={tdStyle}>{d.acceptanceAudience ?? "—"}</td>
                <td style={tdStyle}>
                  <Button variant="ghost" onClick={() => { setOpen(open === d.docKey ? null : d.docKey); loadVersions(d.docKey); }}>{open === d.docKey ? "Hide" : "Versions"}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0, fontSize: 14 }}>Versions of {open}</h4>
            {!versions.some((x) => ["draft", "review", "approved"].includes(x.status)) && (
              <Button
                variant="ghost"
                onClick={async () => {
                  setError(null);
                  try {
                    const r = await createPolicyDraft(open, { reason: "Start a new version" });
                    await loadVersions(open);
                    reload();
                    setEditing(r.id);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Couldn't create a draft");
                  }
                }}
              >
                New version
              </Button>
            )}
          </div>
          {/* Wrapped so a narrow (phone) screen scrolls the table, not the whole page. */}
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>Version</th><th style={thStyle}>Status</th><th style={thStyle}>Changes</th><th style={thStyle}>Legal sign-off</th><th style={thStyle} /></tr></thead>
              <tbody>
                {versions.map((x) => (
                  <tr key={x.id}>
                    <td style={tdStyle}>v{x.version}{x.material ? " · material" : ""}</td>
                    <td style={{ ...tdStyle, color: STATUS_TONE[x.status], fontWeight: 600 }}>{x.status}</td>
                    <td style={{ ...tdStyle, fontSize: 12.5 }}>{x.changeSummary ?? ""}</td>
                    <td style={{ ...tdStyle, fontSize: 12.5 }}>{x.legalReviewerName ? `${x.legalReviewerName}, ${when(x.legalReviewedAt)}` : "—"}</td>
                    <td style={tdStyle}><Button variant="ghost" onClick={() => setEditing(x.id)}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p role="alert" style={errStyle}>{error}</p>}
        </div>
      )}
      {editing !== null && (
        <VersionEditor
          id={editing}
          onClose={() => setEditing(null)}
          onChanged={() => {
            reload();
            if (open) loadVersions(open);
          }}
        />
      )}
    </Card>
  );
}

function PlaceholdersSection({ overview, reload }: { overview: AdminPolicyOverview; reload: () => void }) {
  const [edit, setEdit] = useState<{ name: string; value: string } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rows = [...overview.placeholders, ...overview.extraValues];
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Company details (placeholders)</h3>
      <p style={hint}>Filled into every policy at publish time. Publishing is refused while a document uses a placeholder without a value. Changing a value later does not alter already-published versions.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Placeholder</th><th style={thStyle}>Value</th><th style={thStyle} /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.placeholder}>
                <td style={{ ...tdStyle, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}>[[{p.placeholder}]]</td>
                <td style={{ ...tdStyle, color: p.value ? colors.text : colors.danger }}>{p.value ?? "Not set"}</td>
                <td style={tdStyle}><Button variant="ghost" onClick={() => { setEdit({ name: p.placeholder, value: p.value ?? "" }); setReason(""); setError(null); }}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={`Set [[${edit.name}]]`}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
              <Button
                disabled={!edit.value.trim() || reason.trim().length < 5}
                onClick={async () => {
                  try {
                    await setPolicyPlaceholder(edit.name, edit.value, reason.trim());
                    setEdit(null);
                    reload();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Couldn't save");
                  }
                }}
              >
                Save
              </Button>
            </div>
          }
        >
          <label style={{ display: "block", marginBottom: 10 }}><span style={labelStyle}>Value</span><input value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} style={inputStyle} /></label>
          <label style={{ display: "block" }}><span style={labelStyle}>Reason (required, audited)</span><input value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} /></label>
          {error && <p role="alert" style={errStyle}>{error}</p>}
        </Modal>
      )}
    </Card>
  );
}

// --- complaints ---------------------------------------------------------------------------

function ComplaintsSection() {
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<AdminComplaint[]>([]);
  const [decide, setDecide] = useState<AdminComplaint | null>(null);
  const [decision, setDecision] = useState<"upheld" | "rejected" | "resolved">("resolved");
  const [reasons, setReasons] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => fetchAdminComplaints(status || undefined).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, [status]);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Complaints, notices and appeals</h3>
      <p style={hint}>Every decision needs a statement of reasons; the submitter sees it. An appeal against a moderation decision must be decided by someone other than the admin who made the original decision.</p>
      <label><span style={labelStyle}>Show</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }}>
          <option value="open">New</option>
          <option value="in_review">In review</option>
          <option value="closed">Decided</option>
          <option value="">All</option>
        </select>
      </label>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {rows.map((c) => (
          <div key={c.id} style={{ border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
              <strong>#{c.id} · {c.kind} · {c.subjectType}{c.subjectRef ? ` (${c.subjectRef})` : ""}{c.reportId ? ` · appeal of report #${c.reportId}` : ""}</strong>
              <span style={{ color: colors.mutedLight }}>{when(c.createdAt)} · {c.email}</span>
            </div>
            <p style={{ fontSize: 13.5, whiteSpace: "pre-wrap", margin: "8px 0" }}>{c.body}</p>
            {c.status === "closed" ? (
              <p style={{ fontSize: 13, margin: 0, color: colors.textSoft }}><strong>{c.decision}:</strong> {c.statementOfReasons}</p>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                {c.status === "open" && <Button variant="ghost" onClick={() => decideComplaint(c.id, { status: "in_review" }).then(load)}>Start review</Button>}
                <Button onClick={() => { setDecide(c); setReasons(""); setError(null); }}>Decide…</Button>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <p style={hint}>Nothing here.</p>}
      </div>
      {decide && (
        <Modal
          open
          onClose={() => setDecide(null)}
          title={`Decide #${decide.id}`}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" onClick={() => setDecide(null)}>Cancel</Button>
              <Button
                disabled={reasons.trim().length < 20}
                onClick={async () => {
                  try {
                    await decideComplaint(decide.id, { status: "closed", decision, statementOfReasons: reasons.trim() });
                    setDecide(null);
                    load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Couldn't save");
                  }
                }}
              >
                Send decision
              </Button>
            </div>
          }
        >
          <label style={{ display: "block", marginBottom: 10 }}><span style={labelStyle}>Decision</span>
            <select value={decision} onChange={(e) => setDecision(e.target.value as "upheld")} style={inputStyle}>
              <option value="resolved">Resolved</option>
              <option value="upheld">Upheld (the request is right)</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label style={{ display: "block" }}><span style={labelStyle}>Statement of reasons (the submitter sees this)</span>
            <textarea rows={5} value={reasons} onChange={(e) => setReasons(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} placeholder="What we decided, the facts we relied on, the rule applied, and how to appeal." />
          </label>
          {error && <p role="alert" style={errStyle}>{error}</p>}
        </Modal>
      )}
    </Card>
  );
}

// --- traders --------------------------------------------------------------------------------

function TradersSection() {
  const [status, setStatus] = useState("unverified");
  const [rows, setRows] = useState<AdminTrader[]>([]);
  const [act, setAct] = useState<{ t: AdminTrader; status: "verified" | "rejected" } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => fetchAdminTraders(status || undefined).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, [status]);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Trader verification</h3>
      <p style={hint}>Sellers' DSA/DAC7 details. Tax numbers are masked. Changing a seller's name, address or company number resets them to unverified.</p>
      <label><span style={labelStyle}>Show</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }}>
          <option value="unverified">Not verified</option>
          <option value="verified">Verified</option>
          <option value="rejected">Needs changes</option>
          <option value="">All</option>
        </select>
      </label>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Seller</th><th style={thStyle}>Details</th><th style={thStyle}>Self-certified</th><th style={thStyle} /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={`${t.partyType}:${t.partyId}`}>
                <td style={tdStyle}>{t.legalName}<div style={{ fontSize: 12, color: colors.mutedLight }}>{t.partyType}:{t.partyId} · {t.entityType}</div></td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{t.address}, {t.country}<br />{t.email} · {t.phone}<br />{t.companyNumber ? `Co. ${t.companyNumber} · ` : ""}{t.vatNumber ? `VAT ${t.vatNumber} · ` : ""}TIN {t.tin ?? "missing"}</td>
                <td style={tdStyle}>{t.selfCertifiedAt ? when(t.selfCertifiedAt) : "No"}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <Button variant="ghost" onClick={() => { setAct({ t, status: "verified" }); setNote(""); setError(null); }}>Verify</Button>{" "}
                  <Button variant="ghost" onClick={() => { setAct({ t, status: "rejected" }); setNote(""); setError(null); }}>Needs changes</Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={tdStyle} colSpan={4}>Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
      {act && (
        <Modal
          open
          onClose={() => setAct(null)}
          title={act.status === "verified" ? `Verify ${act.t.legalName}` : `Ask ${act.t.legalName} for changes`}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" onClick={() => setAct(null)}>Cancel</Button>
              <Button
                disabled={note.trim().length < 5}
                onClick={async () => {
                  try {
                    await verifyTrader(act.t.partyType, act.t.partyId, act.status, note.trim());
                    setAct(null);
                    load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Couldn't save");
                  }
                }}
              >
                Save
              </Button>
            </div>
          }
        >
          <label style={{ display: "block" }}><span style={labelStyle}>{act.status === "verified" ? "What you checked (audited)" : "What needs to change (shown to the seller)"}</span>
            <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
          </label>
          {error && <p role="alert" style={errStyle}>{error}</p>}
        </Modal>
      )}
    </Card>
  );
}

// --- the tab ----------------------------------------------------------------------------------

const SECTIONS = [
  { key: "documents", label: "Policy documents", roles: ["super", "legal"] },
  { key: "values", label: "Company details", roles: ["super", "legal"] },
  { key: "complaints", label: "Complaints & appeals", roles: ["super", "support"] },
  { key: "traders", label: "Trader verification", roles: ["super", "legal", "support"] },
] as const;

export function AdminPolicyTab() {
  const { user } = useAuth();
  const role = user?.adminRole ?? "super";
  const visible = SECTIONS.filter((s) => (s.roles as readonly string[]).includes(role));
  const [section, setSection] = useState<string>(visible[0]?.key ?? "");
  const [overview, setOverview] = useState<AdminPolicyOverview | null>(null);
  const reload = () => fetchAdminPolicies().then(setOverview).catch(() => setOverview(null));
  useEffect(() => {
    if (role === "super" || role === "legal") reload();
  }, [role]);
  if (!visible.length) return <p style={hint}>Your admin role doesn't include policy or trust tools.</p>;
  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div role="tablist" aria-label="Policy and trust sections" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {visible.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={section === s.key}
            onClick={() => setSection(s.key)}
            style={{ border: `1px solid ${section === s.key ? colors.green : colors.border}`, background: section === s.key ? colors.greenBg : "transparent", color: section === s.key ? colors.greenText : colors.text, borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {section === "documents" && overview && <DocumentsSection overview={overview} reload={reload} />}
      {section === "values" && overview && <PlaceholdersSection overview={overview} reload={reload} />}
      {section === "complaints" && <ComplaintsSection />}
      {section === "traders" && <TradersSection />}
    </div>
  );
}
