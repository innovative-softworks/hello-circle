import { useAdminCan } from "./admin/adminPermissions";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  commerceRuleAction,
  createCommerceDraft,
  fetchCommerceAudit,
  fetchCommerceOrders,
  fetchCommerceShadow,
  fetchCommerceCatalog,
  fetchCommerceRule,
  fetchCommerceRules,
  previewCommerceRule,
  setCommerceSwitch,
  updateCommerceDraft,
  type CommerceAuditEntry,
  type CommerceOrderRow,
  type CommerceShadowReport,
  type CommerceCatalog,
  type CommerceFieldDiff,
  type CommerceFieldSpec,
  type CommercePreview,
  type CommerceRuleAction,
  type CommerceRuleKeySpec,
  type CommerceRuleVersion,
  type CommerceScopeType,
} from "../api/admin";
import { euro } from "../euro";
import { colors, fonts, radius } from "../theme";
import { LoadFailed, useLoadFailure } from "./admin/loadFailure";
import { Button, ManageCard as Card, Modal, inputStyle, labelStyle, tableStyle, tdStyle, thStyle } from "./ui";

// Commerce Engine Phase 1 — admin view of the versioned commercial rules
// (server/src/commerce/*, routes/adminCommerce.ts). The server is the only
// authority: every validation, the "never in the past" effective-date rule,
// two-person approval and the audit row all happen there; this tab just
// presents them. Nothing here changes a live checkout yet — rule v1 is
// today's pricing, and the engine doesn't price real orders until Phase 2.

const h3: CSSProperties = { fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 6px", letterSpacing: 0 };
const hint: CSSProperties = { fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px", lineHeight: 1.5 };

function isMultiplier(spec: CommerceFieldSpec) {
  return spec.kind === "bps" && spec.max > 10_000;
}

/** Human display of a stored value (bps → %, minor → €, …). */
export function formatRuleValue(spec: CommerceFieldSpec | undefined, value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (!spec || spec.kind === "enum") return String(value).replace(/_/g, " ");
  const n = Number(value);
  if (spec.kind === "bps") return isMultiplier(spec) ? `${n / 10_000}×` : `${(n / 100).toFixed(2)}%`;
  if (spec.kind === "minor") return euro(n / 100);
  return `${n} ${spec.unit}`;
}

/** Editable text for a stored value, in the same friendly unit. */
function toInput(spec: CommerceFieldSpec, value: number | string | undefined): string {
  if (value === undefined) return "";
  if (spec.kind === "enum") return String(value);
  const n = Number(value);
  if (spec.kind === "bps") return isMultiplier(spec) ? String(n / 10_000) : (n / 100).toFixed(2);
  if (spec.kind === "minor") return (n / 100).toFixed(2);
  return String(n);
}

/** Back to the stored integer; null when the text isn't a number. Rounding to
 * an integer here is input normalisation only — the server re-validates. */
function fromInput(spec: CommerceFieldSpec, text: string): number | string | null {
  if (spec.kind === "enum") return text;
  const n = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(n)) return null;
  if (spec.kind === "bps") return Math.round(isMultiplier(spec) ? n * 10_000 : n * 100);
  if (spec.kind === "minor") return Math.round(n * 100);
  return Math.round(n);
}

function unitSuffix(spec: CommerceFieldSpec): string {
  if (spec.kind === "bps") return isMultiplier(spec) ? "×" : "%";
  if (spec.kind === "minor") return "€";
  if (spec.kind === "int") return spec.unit;
  return "";
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function scopeLabel(v: Pick<CommerceRuleVersion, "scopeType" | "scopeId">): string {
  if (v.scopeType === "global") return "Global default";
  return `${v.scopeType[0].toUpperCase()}${v.scopeType.slice(1)}: ${v.scopeId.replace(/_/g, " ")}`;
}

const LIFECYCLE_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: colors.greenBg, fg: colors.greenText, label: "In force" },
  scheduled: { bg: colors.orangeBg, fg: colors.orangeDark, label: "Scheduled" },
  draft: { bg: colors.panel, fg: colors.muted, label: "Draft" },
  approved: { bg: colors.orangeBg, fg: colors.orangeDark, label: "Approved" },
  superseded: { bg: colors.panel, fg: colors.mutedLight, label: "Superseded" },
  ended: { bg: colors.panel, fg: colors.mutedLight, label: "Ended" },
  discarded: { bg: colors.panel, fg: colors.mutedLight, label: "Discarded" },
  review: { bg: colors.orangeBg, fg: colors.orangeDark, label: "In review" },
  retired: { bg: colors.panel, fg: colors.mutedLight, label: "Retired" },
};

function LifecycleBadge({ lifecycle }: { lifecycle: string }) {
  const s = LIFECYCLE_STYLE[lifecycle] ?? LIFECYCLE_STYLE.draft;
  return <span style={{ background: s.bg, color: s.fg, fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: radius.pill, whiteSpace: "nowrap" }}>{s.label}</span>;
}

// --- reason / date action dialog ---------------------------------------------

interface PendingAction {
  version: CommerceRuleVersion;
  action: CommerceRuleAction;
}

const ACTION_COPY: Record<CommerceRuleAction, { title: string; button: string; dateLabel?: string; note: string }> = {
  publish: { title: "Publish this version", button: "Publish", dateLabel: "Takes effect (leave empty for now)", note: "Publishing only changes future quotes. Orders already priced keep their own snapshot." },
  approve: { title: "Approve this version", button: "Approve", note: "You're confirming these exact values. Any later edit voids the approval." },
  discard: { title: "Discard this draft", button: "Discard", note: "The draft is kept for the record but can never be published." },
  end: { title: "End this override", button: "End override", dateLabel: "Ends at (leave empty for now)", note: "Quotes then fall back to the wider rule. The override stays in history." },
  rollback: { title: "Roll back to this version", button: "Roll back", note: "Creates a new version with these values. Nothing in history is rewritten." },
  review: { title: "Send for review", button: "Send for review", note: "Marks this draft as ready for another admin to review and approve." },
  retire: { title: "Retire this version", button: "Retire", note: "A retired version never applies again. An override in force ends now; the global version in force can't be retired." },
};

function ActionDialog({ pending, onClose, onDone }: { pending: PendingAction | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReason("");
    setDate("");
    setError(null);
  }, [pending]);
  if (!pending) return null;
  const copy = ACTION_COPY[pending.action];
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const iso = date ? new Date(date).toISOString() : undefined;
      await commerceRuleAction(pending.version.id, pending.action, {
        reason,
        ...(pending.action === "publish" && iso ? { effectiveFrom: iso } : {}),
        ...(pending.action === "end" && iso ? { effectiveTo: iso } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      subtitle={`${pending.version.ruleKey} · ${scopeLabel(pending.version)} · v${pending.version.version}`}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={pending.action === "discard" ? "danger" : "primary"} disabled={busy || reason.trim().length < 5} onClick={submit}>{copy.button}</Button>
        </div>
      }
    >
      <p style={hint}>{copy.note}</p>
      {copy.dateLabel && (
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={labelStyle}>{copy.dateLabel}</span>
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </label>
      )}
      <label style={{ display: "block" }}>
        <span style={labelStyle}>Reason for this change (required)</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} placeholder="e.g. Agreed 5% success fee for the Dublin pilot" />
      </label>
      {error && <p style={{ color: colors.danger, fontSize: 13, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// --- version editor (new version / edit draft) ----------------------------------

interface EditorState {
  spec: CommerceRuleKeySpec;
  /** Present when editing an existing draft. */
  draft?: CommerceRuleVersion;
  base: Record<string, number | string>;
}

function VersionEditor({ state, catalog, onClose, onSaved }: { state: EditorState | null; catalog: CommerceCatalog; onClose: () => void; onSaved: () => void }) {
  const [scopeType, setScopeType] = useState<CommerceScopeType>("global");
  const [scopeId, setScopeId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    const st = state.draft?.scopeType ?? "global";
    setScopeType(st);
    setScopeId(state.draft?.scopeId ?? "");
    const source = state.draft?.payload ?? state.base;
    setValues(Object.fromEntries(Object.entries(state.spec.fields).map(([k, f]) => [k, toInput(f, source[k] ?? state.base[k])])));
    setIncluded(Object.fromEntries(Object.keys(state.spec.fields).map((k) => [k, st === "global" || state.draft?.payload[k] !== undefined])));
    setReason("");
    setError(null);
  }, [state]);

  if (!state) return null;
  const { spec, draft } = state;
  const isGlobal = scopeType === "global";

  const save = async () => {
    setError(null);
    const payload: Record<string, number | string> = {};
    for (const [k, f] of Object.entries(spec.fields)) {
      if (!isGlobal && !included[k]) continue;
      const v = fromInput(f, values[k] ?? "");
      if (v === null) return setError(`${f.label} needs a number`);
      payload[k] = v;
    }
    setBusy(true);
    try {
      if (draft) await updateCommerceDraft(draft.id, { payload, reason });
      else await createCommerceDraft({ key: spec.key, scopeType, scopeId: isGlobal ? "" : scopeId, payload, reason });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={draft ? `Edit draft v${draft.version}` : `New version — ${spec.label}`}
      subtitle="Saved as a draft. Nothing changes until it is published."
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || reason.trim().length < 5 || (!isGlobal && !scopeId)} onClick={save}>Save draft</Button>
        </div>
      }
    >
      {!draft && (
        <div className="stack-mobile" style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>Applies to</span>
            <select value={scopeType} onChange={(e) => {
              const next = e.target.value as CommerceScopeType;
              setScopeType(next);
              setScopeId("");
              // A global version sets every value; an override starts with
              // none ticked, so it only pins what the admin deliberately changes
              // (anything left unticked keeps following future global changes).
              setIncluded(Object.fromEntries(Object.keys(spec.fields).map((k) => [k, next === "global"])));
            }} style={inputStyle}>
              {spec.scopes.map((s) => <option key={s} value={s}>{s === "global" ? "Global default" : s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </label>
          {scopeType === "scenario" || scopeType === "category" ? (
            <label style={{ flex: 1 }}>
              <span style={labelStyle}>{scopeType === "scenario" ? "Scenario" : "Resource type"}</span>
              <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} style={inputStyle}>
                <option value="">Choose…</option>
                {(scopeType === "scenario" ? catalog.scenarios : catalog.categories).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </label>
          ) : scopeType === "partner" ? (
            <label style={{ flex: 1 }}>
              <span style={labelStyle}>Partner (org:&lt;organisation id&gt; or host:&lt;resident id&gt;)</span>
              <input value={scopeId} onChange={(e) => setScopeId(e.target.value.trim())} style={inputStyle} placeholder="org:…" />
            </label>
          ) : null}
        </div>
      )}
      {!isGlobal && <p style={hint}>Tick only the values this override should change; everything else keeps following the wider rule.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
        {Object.entries(spec.fields).map(([k, f]) => (
          <label key={k} style={{ display: "block", opacity: isGlobal || included[k] ? 1 : 0.55 }}>
            <span style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
              {!isGlobal && <input type="checkbox" checked={!!included[k]} onChange={(e) => setIncluded({ ...included, [k]: e.target.checked })} style={{ accentColor: colors.green }} />}
              {f.label}
            </span>
            {f.kind === "enum" ? (
              <select value={values[k] ?? ""} disabled={!isGlobal && !included[k]} onChange={(e) => setValues({ ...values, [k]: e.target.value })} style={inputStyle}>
                {f.values.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
              </select>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input inputMode="decimal" value={values[k] ?? ""} disabled={!isGlobal && !included[k]} onChange={(e) => setValues({ ...values, [k]: e.target.value })} style={inputStyle} />
                <span style={{ fontSize: 12.5, color: colors.mutedLight, whiteSpace: "nowrap" }}>{unitSuffix(f)}</span>
              </div>
            )}
            {f.help && <span style={{ display: "block", fontSize: 11.5, color: colors.mutedLight, marginTop: 4 }}>{f.help}</span>}
          </label>
        ))}
      </div>
      <label style={{ display: "block", marginTop: 16 }}>
        <span style={labelStyle}>Reason for this change (required)</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </label>
      {error && <p style={{ color: colors.danger, fontSize: 13, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// --- details / impact preview -----------------------------------------------------

function ChangesTable({ spec, changes }: { spec: CommerceRuleKeySpec | undefined; changes: CommerceFieldDiff[] }) {
  if (!changes.length) return <p style={hint}>No value changes.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead><tr><th style={thStyle}>Value</th><th style={thStyle}>From</th><th style={thStyle}>To</th></tr></thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.field}>
              <td style={tdStyle}>{c.label}</td>
              <td style={tdStyle}>{formatRuleValue(spec?.fields[c.field], c.from)}</td>
              <td style={{ ...tdStyle, fontWeight: 700 }}>{formatRuleValue(spec?.fields[c.field], c.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const m = (minor: number) => euro(minor / 100);

function DetailsModal({ version, spec, onClose }: { version: CommerceRuleVersion | null; spec: CommerceRuleKeySpec | undefined; onClose: () => void }) {
  const [vsPrevious, setVsPrevious] = useState<CommerceFieldDiff[] | null>(null);
  const [preview, setPreview] = useState<CommercePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setVsPrevious(null);
    setPreview(null);
    setError(null);
    if (!version) return;
    // A failed comparison is an error, never "no changes".
    fetchCommerceRule(version.id)
      .then((r) => setVsPrevious(r.changesFromPrevious))
      .catch((e) => setError(`Couldn't load the comparison with the previous version: ${e instanceof Error ? e.message : "request failed"}`));
    if (version.status === "draft" || version.status === "review" || version.status === "approved") {
      previewCommerceRule(version.id).then(setPreview).catch((e) => setError(e instanceof Error ? e.message : "Preview failed"));
    }
  }, [version]);
  if (!version) return null;
  return (
    <Modal open onClose={onClose} size="wide" title={`${spec?.label ?? version.ruleKey} — v${version.version}`} subtitle={`${scopeLabel(version)} · ${version.changeReason}`}>
      <h5 style={{ ...h3, fontSize: 14 }}>Values</h5>
      <div style={{ overflowX: "auto", marginBottom: 18 }}>
        <table style={tableStyle}>
          <tbody>
            {Object.entries(version.payload).map(([k, v]) => (
              <tr key={k}><td style={tdStyle}>{spec?.fields[k]?.label ?? k}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{formatRuleValue(spec?.fields[k], v)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h5 style={{ ...h3, fontSize: 14 }}>Compared with the version before it</h5>
      {vsPrevious ? <ChangesTable spec={spec} changes={vsPrevious} /> : <p style={hint}>Loading…</p>}
      {(version.status === "draft" || version.status === "review" || version.status === "approved") && (
        <>
          <h5 style={{ ...h3, fontSize: 14, marginTop: 18 }}>Impact if published now</h5>
          {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
          {preview && (
            <>
              <ChangesTable spec={spec} changes={preview.changes} />
              {preview.samples.length > 0 && (
                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>List price</th>
                        <th style={thStyle}>Customer pays now</th>
                        <th style={thStyle}>Customer would pay</th>
                        <th style={thStyle}>Partner payout now → then</th>
                        <th style={thStyle}>HelloCircle revenue now → then</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.samples.map((s) => (
                        <tr key={s.listMinor}>
                          <td style={tdStyle}>{m(s.listMinor)}</td>
                          <td style={tdStyle}>{m(s.current.customerPaidMinor)}</td>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{m(s.proposed.customerPaidMinor)}</td>
                          <td style={tdStyle}>{m(s.current.partnerPayoutMinor)} → {m(s.proposed.partnerPayoutMinor)}</td>
                          <td style={tdStyle}>{m(s.current.platformRevenueMinor)} → {m(s.proposed.platformRevenueMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.recentOrders.length > 0 && (
                <>
                  <p style={{ ...hint, marginTop: 14 }}>Recent paid orders re-priced under this draft (illustration only — their real charges never change):</p>
                  <div style={{ overflowX: "auto" }}>
                    <table style={tableStyle}>
                      <thead><tr><th style={thStyle}>Order</th><th style={thStyle}>Charged</th><th style={thStyle}>Would charge</th><th style={thStyle}>Partner payout</th><th style={thStyle}>HelloCircle revenue</th></tr></thead>
                      <tbody>
                        {preview.recentOrders.map((o) => (
                          <tr key={o.ref}>
                            <td style={tdStyle}>{o.kind} · {o.ref}</td>
                            <td style={tdStyle}>{m(o.chargedMinor)}</td>
                            <td style={{ ...tdStyle, fontWeight: 700 }}>{m(o.proposedCustomerPaidMinor)}</td>
                            <td style={tdStyle}>{m(o.proposedPartnerPayoutMinor)}</td>
                            <td style={tdStyle}>{m(o.proposedPlatformRevenueMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}

// --- one rule key ----------------------------------------------------------------

function RuleCard({
  spec,
  versions,
  secondApprover,
  onNew,
  onEdit,
  onAction,
  onDetails,
}: {
  spec: CommerceRuleKeySpec;
  versions: CommerceRuleVersion[];
  secondApprover: boolean;
  onNew: (base: Record<string, number | string>) => void;
  onEdit: (v: CommerceRuleVersion, base: Record<string, number | string>) => void;
  onAction: (v: CommerceRuleVersion, a: CommerceRuleAction) => void;
  onDetails: (v: CommerceRuleVersion) => void;
}) {
  const global = versions.find((v) => v.scopeType === "global" && v.inForce);
  const base = global?.payload ?? spec.v1;
  const [showHistory, setShowHistory] = useState(false);
  const visible = showHistory ? versions : versions.filter((v) => !["superseded", "ended", "discarded", "retired"].includes(v.lifecycle));
  return (
    <Card style={{ padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={h3}>{spec.label}</h3>
          <p style={hint}>{spec.description}</p>
          {spec.appliesTo && (
            <p style={{ ...hint, color: /^Not applied yet/.test(spec.appliesTo) ? colors.danger : colors.text }}>
              <strong>Where this takes effect:</strong> {spec.appliesTo}
            </p>
          )}
        </div>
        <Button onClick={() => onNew(base)}>New version</Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 16 }}>
        {Object.entries(spec.fields).map(([k, f]) => (
          <div key={k} style={{ background: colors.panel, borderRadius: radius.swiss.card, padding: "10px 12px" }}>
            <div style={{ fontSize: 11.5, color: colors.mutedLight }}>{f.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{formatRuleValue(f, base[k])}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Version</th>
              <th style={thStyle}>Applies to</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Effective</th>
              <th style={thStyle}>Reason</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {visible.map((v) => {
              const editable = v.status === "draft" || v.status === "review" || v.status === "approved";
              return (
                <tr key={v.id}>
                  <td style={tdStyle}>v{v.version}</td>
                  <td style={tdStyle}>{scopeLabel(v)}</td>
                  <td style={tdStyle}><LifecycleBadge lifecycle={v.lifecycle} /></td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>
                    {v.effectiveFrom ? when(v.effectiveFrom) : "—"}
                    {v.effectiveTo && <div style={{ color: colors.mutedLight }}>until {when(v.effectiveTo)}</div>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12.5, maxWidth: 280 }}>{v.changeReason}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <Button variant="ghost" onClick={() => onDetails(v)}>{editable ? "Preview" : "View"}</Button>
                      {editable && <Button variant="ghost" onClick={() => onEdit(v, base)}>Edit</Button>}
                      {v.status === "draft" && <Button variant="ghost" onClick={() => onAction(v, "review")}>Send for review</Button>}
                      {(v.status === "draft" || v.status === "review") && secondApprover && <Button variant="ghost" onClick={() => onAction(v, "approve")}>Approve</Button>}
                      {editable && <Button onClick={() => onAction(v, "publish")}>Publish</Button>}
                      {editable && <Button variant="ghost" onClick={() => onAction(v, "discard")}>Discard</Button>}
                      {v.status === "published" && v.scopeType !== "global" && (v.lifecycle === "active" || v.lifecycle === "scheduled") && (
                        <Button variant="ghost" onClick={() => onAction(v, "end")}>End</Button>
                      )}
                      {v.status === "published" && !v.inForce && v.lifecycle !== "scheduled" && <Button variant="ghost" onClick={() => onAction(v, "rollback")}>Roll back to this</Button>}
                      {v.status === "published" && !(v.scopeType === "global" && v.inForce) && <Button variant="ghost" onClick={() => onAction(v, "retire")}>Retire</Button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setShowHistory(!showHistory)} style={{ background: "none", border: "none", color: colors.greenText, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "10px 0 0" }}>
        {showHistory ? "Hide history" : `Show full history (${versions.length} versions)`}
      </button>
    </Card>
  );
}

// --- switches + audit ----------------------------------------------------------------

// D-02 — mirrors GOVERNANCE_SWITCHES in server/src/routes/adminCommerce.ts:
// switches that aren't financial stay Super-only.
const GOVERNANCE_SWITCHES = new Set(["commerce.require_second_approver", "commerce.paid_games_require_verified_host", "commerce.open_booking"]);

function SwitchesCard({ catalog, onChanged }: { catalog: CommerceCatalog; onChanged: () => void }) {
  const canGovernance = useAdminCan()("commerce.governance_switches");
  const [pending, setPending] = useState<{ key: string; label: string; enabled: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!pending) return;
    setError(null);
    try {
      await setCommerceSwitch(pending.key, pending.enabled, reason);
      setPending(null);
      setReason("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change that switch");
    }
  };
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Switches</h3>
      <p style={hint}>Rollout switches stay off and do nothing until the phase that uses them ships. With every rollout switch off, checkout runs exactly as before.</p>
      {catalog.switches.map((s) => (
        <div key={s.key} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: `1px solid ${colors.border}` }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>
              {s.description}
              {s.activeFromPhase !== null && <> · <em>no effect until Phase {s.activeFromPhase}</em></>}
            </div>
            {s.whenOn && (
              <div style={{ fontSize: 12, color: colors.text, marginTop: 4 }} data-testid={`switch-when-on-${s.key}`}>
                <strong>When on:</strong> {s.whenOn}
              </div>
            )}
            {GOVERNANCE_SWITCHES.has(s.key) && !canGovernance && (
              <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>Only a super admin can change this switch.</div>
            )}
            {(catalog.switchDependencies?.[s.key] ?? []).length > 0 && (
              <div style={{ fontSize: 12, marginTop: 2 }} data-testid={`switch-needs-${s.key}`}>
                Needs: {(catalog.switchDependencies?.[s.key] ?? []).map((d) => catalog.switches.find((x) => x.key === d)?.label ?? d).join(", ")}
              </div>
            )}
          </div>
          <input
            type="checkbox"
            aria-label={s.label}
            checked={s.enabled}
            disabled={GOVERNANCE_SWITCHES.has(s.key) && !canGovernance}
            onChange={(e) => { setPending({ key: s.key, label: s.label, enabled: e.target.checked }); setReason(""); setError(null); }}
            style={{ accentColor: colors.green, width: 18, height: 18, flex: "none" }}
          />
        </div>
      ))}
      {pending && (
        <Modal
          open
          onClose={() => setPending(null)}
          title={`${pending.enabled ? "Turn on" : "Turn off"}: ${pending.label}`}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
              <Button disabled={reason.trim().length < 5} onClick={save}>Confirm</Button>
            </div>
          }
        >
          <label style={{ display: "block" }}>
            <span style={labelStyle}>Reason (required)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </label>
          {error && <p style={{ color: colors.danger, fontSize: 13, marginTop: 10 }}>{error}</p>}
        </Modal>
      )}
    </Card>
  );
}

function AuditCard({ entries }: { entries: CommerceAuditEntry[] }) {
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Change log</h3>
      <p style={hint}>Every commercial change, who made it and why. Read-only.</p>
      {entries.length === 0 ? (
        <p style={hint}>No changes yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead><tr><th style={thStyle}>When</th><th style={thStyle}>Who</th><th style={thStyle}>What</th><th style={thStyle}>Reason</th></tr></thead>
            <tbody>
              {entries.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...tdStyle, fontSize: 12.5, whiteSpace: "nowrap" }}>{when(a.createdAt)}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{a.actorEmail ?? a.actorUserId ?? "system"}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{a.action.replace(/^commerce_(rule|switch)\./, "").replace(/_/g, " ")} · {a.objectType === "commerce_rule" ? `#${a.objectId}` : a.objectId}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5, maxWidth: 360 }}>{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// --- Phase 2: shadow pricing + orders ------------------------------------------------------

function ShadowCard({ report }: { report: CommerceShadowReport | null }) {
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Shadow pricing</h3>
      <p style={hint}>
        With the shadow switch on, every checkout is also priced by the published rules and compared with what the customer was actually charged.
        A resource type is ready for the engine only once it shows zero unexplained mismatches. Last 30 days:
      </p>
      {!report || report.summary.length === 0 ? (
        <p style={hint}>No shadow comparisons yet. Turn on "Shadow pricing" in Switches above to start collecting them (types already on the engine aren't shadowed).</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead><tr><th style={thStyle}>Type</th><th style={thStyle}>Matched</th><th style={thStyle}>Mismatched</th><th style={thStyle}>Last checkout</th></tr></thead>
            <tbody>
              {report.summary.map((s) => (
                <tr key={s.sourceType}>
                  <td style={tdStyle}>{s.sourceType}</td>
                  <td style={tdStyle}>{s.matched}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: s.mismatched ? colors.danger : colors.greenText }}>{s.mismatched}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(s.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report && report.mismatches.length > 0 && (
        <>
          <p style={{ ...hint, marginTop: 14 }}>Most recent mismatches (an expected result if a rule was deliberately changed for that type):</p>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>When</th><th style={thStyle}>Order</th><th style={thStyle}>Differs in</th><th style={thStyle}>Charged</th><th style={thStyle}>Rules would charge</th></tr></thead>
              <tbody>
                {report.mismatches.map((x) => (
                  <tr key={x.id}>
                    <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(x.createdAt)}</td>
                    <td style={tdStyle}>{x.sourceType} · {x.sourceRef}</td>
                    <td style={tdStyle}>{x.diffFields}</td>
                    <td style={tdStyle}>{m(x.legacyTotalMinor)}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{m(x.engineTotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function OrdersCard() {
  const [orders, setOrders] = useState<CommerceOrderRow[] | null>(null);
  const [q, setQ] = useState("");
  const { failed, track } = useLoadFailure();
  const load = (query?: string) => track(fetchCommerceOrders(query), setOrders);
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Orders</h3>
      <LoadFailed failed={failed} onRetry={() => load(q.trim() || undefined)} />
      <p style={hint}>Orders priced by the commerce engine, each with its frozen pricing snapshot. Search by order id, booking reference, Stripe session or partner id.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(q.trim() || undefined);
        }}
        style={{ display: "flex", gap: 8, marginBottom: 12 }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={inputStyle} />
        <Button type="submit" variant="ghost">Search</Button>
      </form>
      {!orders ? (
        failed ? null : <p style={hint}>Loading…</p>
      ) : orders.length === 0 && failed ? null : orders.length === 0 ? (
        <p style={hint}>No engine-priced orders yet. They appear once the engine is switched on for a resource type.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Booking</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Customer paid</th>
                <th style={thStyle}>Partner payout</th>
                <th style={thStyle}>HelloCircle revenue</th>
                <th style={thStyle}>Rule versions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td style={{ ...tdStyle, fontSize: 12.5, whiteSpace: "nowrap" }}>{when(o.createdAt)}</td>
                  <td style={tdStyle}>{o.sourceType} · {o.sourceRef}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{o.orderStatus.replace(/_/g, " ")} · {o.paymentStatus.replace(/_/g, " ")}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{m(o.customerPaidMinor)}</td>
                  <td style={tdStyle}>{m(o.partnerPayoutMinor)}</td>
                  <td style={tdStyle}>{m(o.platformRevenueMinor)}</td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>{o.ruleSources.map((r) => `${r.scopeType === "global" ? "global" : r.scopeId} v${r.version}`).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// --- the tab -----------------------------------------------------------------------------

// Stage 5f — Admin → Commercial rules sections (keys not listed fall into "Checkout, settlement and payouts").
const SECTIONS: { id: string; title: string; keys?: string[]; note?: string }[] = [
  { id: "switches", title: "Feature switches", note: "Each change needs a reason and is audited. Switches that depend on others can't be turned on (or their prerequisites off) in an invalid combination." },
  { id: "pro", title: "Pro pricing", keys: ["plan_free", "plan_pro", "plan_rules", "entitlements_free", "entitlements_pro", "subscription_policy"], note: "The success-fee and minimum-fee values in the Free/Pro plan rules feed only the estimator and simulator (hypothetical). Checkout and settlement charge with the Pricing rule (customer platform fee + VAT on top, no partner success fee) — R3B finding F1. The Pro subscription price is what Pro billing would charge." },
  { id: "rewards", title: "Reward points", keys: ["rewards", "split_rewards"], note: "Partner reward points (not customer credit)." },
  { id: "credit", title: "Customer credit", keys: ["credits"], note: "Customer credit is granted in Admin → Finance → Credits & Pro." },
  { id: "coupons", title: "Coupons", note: "Coupon codes, limits and funding are managed in Admin → Coupons; usage is in Admin → Finance → Coupons." },
  { id: "tax", title: "VAT and tax", keys: ["tax_vat", "vat_treatment"], note: "VAT treatment is provisional pending Irish tax review." },
  { id: "help", title: "Help content", note: "Explanations shown to partners and customers are edited in Admin → Settings → Field help (versioned)." },
  { id: "other", title: "Checkout, settlement and payouts", keys: ["pricing", "checkout", "cancellation", "payment_costs", "settlement", "venue_split", "availability"] },
  { id: "history", title: "Version history", note: "Every rule and switch change, with who, when and why." },
];

export function AdminCommerceTab() {
  const [catalog, setCatalog] = useState<CommerceCatalog | null>(null);
  const [rules, setRules] = useState<CommerceRuleVersion[]>([]);
  const [audit, setAudit] = useState<CommerceAuditEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [details, setDetails] = useState<CommerceRuleVersion | null>(null);
  const [shadow, setShadow] = useState<CommerceShadowReport | null>(null);

  const load = () => {
    fetchCommerceShadow().then(setShadow).catch(() => setShadow(null));
    Promise.all([fetchCommerceCatalog(), fetchCommerceRules(), fetchCommerceAudit()])
      .then(([c, r, a]) => {
        setCatalog(c);
        setRules(r);
        setAudit(a);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load commercial rules"));
  };
  useEffect(load, []);

  const byKey = useMemo(() => {
    const map = new Map<string, CommerceRuleVersion[]>();
    for (const r of rules) map.set(r.ruleKey, [...(map.get(r.ruleKey) ?? []), r]);
    return map;
  }, [rules]);

  if (loadError) return <p style={{ color: colors.danger }}>{loadError}</p>;
  if (!catalog) return <p style={hint}>Loading…</p>;

  const specOf = (key: string) => catalog.ruleKeys.find((k) => k.key === key);
  const done = () => {
    setEditor(null);
    setAction(null);
    load();
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card style={{ padding: 22 }}>
        <h3 style={h3}>Commercial rules</h3>
        <p style={{ ...hint, marginBottom: 0 }}>
          Every fee, rate and policy here is versioned. Changes start as drafts, need a reason, and take effect from the moment you publish
          (or a future date you choose), never in the past, so historical orders keep the price they were charged.
          {catalog.secondApproverRequired ? " Two-person approval is on: a different admin must approve a draft before it can be published." : ""}
          {" "}These rules don't price live checkouts yet. Version 1 mirrors today's pricing exactly, and the engine is switched on per resource type in a later phase.
        </p>
      </Card>
      {/* Stage 5f — clearly separated sections, with an in-page index. */}
      <nav aria-label="Commercial rules sections" style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13.5 }}>
        {SECTIONS.map((sec) => (
          <a key={sec.id} href={`#cr-${sec.id}`} style={{ color: colors.text, fontWeight: 700 }}>
            {sec.title}
          </a>
        ))}
      </nav>
      {SECTIONS.map((sec) => (
        <section key={sec.id} id={`cr-${sec.id}`} aria-labelledby={`cr-h-${sec.id}`} style={{ display: "flex", flexDirection: "column", gap: 16, scrollMarginTop: 80 }}>
          <h3 id={`cr-h-${sec.id}`} style={{ ...h3, fontSize: 19, margin: "8px 0 0" }}>{sec.title}</h3>
          {sec.note && <p style={{ ...hint, margin: 0 }}>{sec.note}</p>}
          {sec.id === "switches" && <SwitchesCard catalog={catalog} onChanged={load} />}
          {sec.id === "history" && <AuditCard entries={audit} />}
          {(sec.keys ?? [])
            .map((k) => catalog.ruleKeys.find((r) => r.key === k))
            .filter((spec): spec is CommerceRuleKeySpec => !!spec)
            .map((spec) => (
              <RuleCard
                key={spec.key}
                spec={spec}
                versions={byKey.get(spec.key) ?? []}
                secondApprover={catalog.secondApproverRequired}
                onNew={(base) => setEditor({ spec, base })}
                onEdit={(v, base) => setEditor({ spec, draft: v, base })}
                onAction={(v, a) => setAction({ version: v, action: a })}
                onDetails={setDetails}
              />
            ))}
          {sec.id === "other" &&
            catalog.ruleKeys
              .filter((spec) => !SECTIONS.some((x) => x.id !== "other" && (x.keys ?? []).includes(spec.key)) && !(SECTIONS.find((x) => x.id === "other")?.keys ?? []).includes(spec.key))
              .map((spec) => (
                <RuleCard
                  key={spec.key}
                  spec={spec}
                  versions={byKey.get(spec.key) ?? []}
                  secondApprover={catalog.secondApproverRequired}
                  onNew={(base) => setEditor({ spec, base })}
                  onEdit={(v, base) => setEditor({ spec, draft: v, base })}
                  onAction={(v, a) => setAction({ version: v, action: a })}
                  onDetails={setDetails}
                />
              ))}
          {sec.id === "other" && (
            <>
              <ShadowCard report={shadow} />
              <OrdersCard />
            </>
          )}
        </section>
      ))}
      <VersionEditor state={editor} catalog={catalog} onClose={() => setEditor(null)} onSaved={done} />
      <ActionDialog pending={action} onClose={() => setAction(null)} onDone={done} />
      <DetailsModal version={details} spec={details ? specOf(details.ruleKey) : undefined} onClose={() => setDetails(null)} />
    </div>
  );
}
