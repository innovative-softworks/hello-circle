import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, Info, Search } from "lucide-react";
import { Button, Modal, inputStyle } from "../../components/ui";
import "./account.css";
import { useConfirm } from "../../components/ConfirmProvider";

// Shared parts for the account area (account redesign 2026-10-24). They sit
// on ui.tsx's Button / Switch / ConfirmDialog / Modal / Toast rather than
// replacing them; the layout classes live in account.css.

// --- Page + sections ----------------------------------------------------------

/** True when an AccountPage renders as one tab of a parent page. */
export const AccountTabContext = createContext(false);

/** Wraps account pages shown outside AccountShell (e.g. My Life tabs) so they
 * get the account fonts/tokens and render in tab mode. */
export function AccountTab({ children }: { children: ReactNode }) {
  return (
    <div className="acct-embed">
      <AccountTabContext.Provider value={true}>{children}</AccountTabContext.Provider>
    </div>
  );
}

export function AccountPage({
  eyebrow,
  title,
  lede,
  actions,
  narrow,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  /** Settings pages: a comfortable reading width. Library pages use the full column. */
  narrow?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const confirmLeave = useConfirmLeave();
  // Inside a parent's tab bar (My Life, Payments) the tab already names the
  // page: no back link, eyebrow or title — just the lede and actions.
  if (useContext(AccountTabContext)) {
    return (
      <div className={`acct-page${narrow ? " acct-page--narrow" : ""}`}>
        {(lede || actions) && (
          <div className="acct-head acct-head--tab">
            {lede ? <p className="acct-lede" style={{ margin: 0 }}>{lede}</p> : <span />}
            {actions && <div className="acct-head-actions">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    );
  }
  return (
    <div className={`acct-page${narrow ? " acct-page--narrow" : ""}`}>
      {/* Phones: back to the account home (the desktop rail makes it redundant). */}
      <Link
        to="/profile"
        className="acct-back"
        onClick={async (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          if (await confirmLeave()) navigate("/profile");
        }}
      >
        <ChevronLeft size={18} aria-hidden="true" /> Account
      </Link>
      <header className="acct-head">
        <div>
          {eyebrow && <div className="acct-eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {lede && <p className="acct-lede">{lede}</p>}
        </div>
        {actions && <div className="acct-head-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function AccountSection({
  title,
  description,
  action,
  children,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const autoId = useId();
  const headingId = id ?? autoId;
  return (
    <section className="acct-section" aria-labelledby={title ? headingId : undefined}>
      {(title || action) && (
        <div className="acct-section-head">
          <div>
            {title && <h2 id={headingId}>{title}</h2>}
            {description && <p className="acct-section-desc">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SettingRows({ children }: { children: ReactNode }) {
  return <div className="acct-rows">{children}</div>;
}

export function SettingRow({
  label,
  description,
  control,
  stack,
  labelId,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  /** Put the control under the label on phones (values, inputs — not switches). */
  stack?: boolean;
  labelId?: string;
}) {
  return (
    <div className={`acct-row${stack ? " acct-row--stack" : ""}`}>
      <div style={{ minWidth: 0 }}>
        <div className="acct-row-label" id={labelId}>{label}</div>
        {description && <div className="acct-row-desc">{description}</div>}
      </div>
      <div className="acct-row-control">{control}</div>
    </div>
  );
}

export function TextButton({
  children,
  onClick,
  disabled,
  danger,
  ...aria
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  return (
    <button type="button" className={`acct-text-btn${danger ? " acct-text-btn--danger" : ""}`} onClick={onClick} disabled={disabled} {...aria}>
      {children}
    </button>
  );
}

// --- Selection ------------------------------------------------------------------

export function Chip({ pressed, onClick, disabled, children }: { pressed: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="acct-chip" aria-pressed={pressed} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  // Inside a My Life tab (owner 2026-10-26: "tabs inside tabs is not good"),
  // a type filter is a row of chips, not a second row of tabs.
  const inTab = useContext(AccountTabContext);
  if (inTab) {
    return (
      <div className="acct-topics" role="group" aria-label={label} style={{ margin: 0 }}>
        {options.map((o) => (
          <button key={o.key} type="button" className="acct-chip" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
            {o.label}
            {o.count !== undefined && <span style={{ marginLeft: 6, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{o.count}</span>}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="acct-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
          {o.count !== undefined && <span className="acct-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  const id = useId();
  return (
    <div className="acct-search">
      <label htmlFor={id} className="acct-sr">{label}</label>
      <Search size={17} aria-hidden="true" />
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

// --- Status + messages ----------------------------------------------------------

export type Tone = "ok" | "warn" | "danger" | "muted";

export function StatusTag({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return <span className="acct-tag" data-tone={tone}>{children}</span>;
}

export function Note({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="acct-note">
      {icon ?? <Info size={16} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}

export function AccountEmpty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="acct-empty">
      <div className="acct-empty-icon" aria-hidden="true">{icon}</div>
      <h2 className="acct-empty-title">{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

// --- Unsaved changes ------------------------------------------------------------
// BrowserRouter has no navigation blocker, so the guard covers what is under
// this area's control: the account nav (AccountShell asks before leaving a
// page with unsaved edits) and closing/reloading the tab (beforeunload).
// Links elsewhere in the app (header, footer) are not intercepted.

type DirtyApi = { setDirty: (key: string, dirty: boolean) => void; confirmLeave: () => Promise<boolean> };
const DirtyContext = createContext<DirtyApi | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(new Set<string>());
  const confirm = useConfirm();
  const setDirty = useCallback((key: string, d: boolean) => {
    if (d) dirty.current.add(key);
    else dirty.current.delete(key);
  }, []);
  const confirmLeave = useCallback(async () => {
    if (dirty.current.size === 0) return true;
    const ok = await confirm({
      title: "Leave without saving?",
      message: "You have changes on this page that haven't been saved.",
      confirmLabel: "Leave without saving",
      cancelLabel: "Keep editing",
      tone: "danger",
    });
    if (ok) dirty.current.clear();
    return ok;
  }, [confirm]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  return <DirtyContext.Provider value={{ setDirty, confirmLeave }}>{children}</DirtyContext.Provider>;
}

export function useConfirmLeave(): () => Promise<boolean> {
  return useContext(DirtyContext)?.confirmLeave ?? (async () => true);
}

/** Marks this page as having unsaved edits while `dirty` is true. */
export function useUnsavedChanges(dirty: boolean) {
  const ctx = useContext(DirtyContext);
  const key = useId();
  useEffect(() => {
    ctx?.setDirty(key, dirty);
    return () => ctx?.setDirty(key, false);
  }, [ctx, key, dirty]);
}

/** Sticky bar shown while a form has unsaved changes. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveLabel = "Save changes",
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
}) {
  useUnsavedChanges(dirty);
  if (!dirty && !saving) return null;
  return (
    <div className="acct-savebar" role="region" aria-label="Unsaved changes">
      <span className="acct-savebar-msg">{saving ? "Saving…" : "You have unsaved changes"}</span>
      <div className="acct-savebar-actions">
        <TextButton onClick={onDiscard} disabled={saving}>Discard</TextButton>
        <Button onClick={onSave} disabled={saving} aria-busy={saving}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}

// --- Formatting -------------------------------------------------------------------

export function dateLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

/** "Today" / "Yesterday" / "This week" / "Earlier" — for chronological grouping. */
export function dayBucket(iso: string, now = new Date()): "Today" | "Yesterday" | "This week" | "Earlier" {
  const d = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "Today";
  if (t >= start - 86_400_000) return "Yesterday";
  if (t >= start - 6 * 86_400_000) return "This week";
  return "Earlier";
}

// --- Forms open in a centred popup (owner 2026-10-24: "don't open forms
// inline, show them as a popup") --------------------------------------------

/** A form in the shared centred Modal: Save / Cancel pinned in the footer,
 * Enter submits, a thrown error stays in the popup, and closing a changed
 * form asks first (Modal's confirmClose). */
export function FormModal({
  open,
  title,
  subtitle,
  submitLabel = "Save",
  dirty,
  onClose,
  onSubmit,
  error,
  size,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  submitLabel?: string;
  dirty: boolean;
  onClose: () => void;
  /** Return false to stay open without an error (e.g. field validation). Throw to show an error. */
  onSubmit: () => Promise<boolean | void>;
  /** Extra error to show (e.g. from validation in the caller). */
  error?: string | null;
  size?: "default" | "wide";
  children: ReactNode;
}) {
  const formId = useId();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (open) setFailure(null);
  }, [open]);
  const submit = async () => {
    setSaving(true);
    setFailure(null);
    try {
      const ok = await onSubmit();
      if (ok !== false) onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };
  const shown = failure ?? error ?? null;
  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={title}
      subtitle={subtitle}
      size={size}
      confirmClose={dirty ? { title: "Discard your changes?", message: "What you've entered here hasn't been saved." } : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving} aria-busy={saving}>{saving ? "Saving…" : submitLabel}</Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: "grid", gap: 16 }}
      >
        {shown && <p className="acct-field-error" role="alert" style={{ margin: 0 }}>{shown}</p>}
        {children}
        {/* Lets Enter in any field submit the form. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

// --- Editable field -----------------------------------------------------------
// Row shows the value + "Edit"; editing happens in a FormModal.

export function InlineField({
  label,
  description,
  display,
  empty,
  initial,
  renderEditor,
  validate,
  onSave,
}: {
  label: string;
  description?: ReactNode;
  /** What the row shows when not editing. */
  display: ReactNode;
  empty?: boolean;
  /** The draft's starting value when editing opens. */
  initial: string;
  renderEditor: (p: { id: string; value: string; onChange: (v: string) => void; invalid: boolean; describedBy?: string }) => ReactNode;
  validate?: (v: string) => string | null;
  /** Throw to show an error and keep the popup open. */
  onSave: (v: string) => Promise<void>;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setDraft(initial);
    setError(null);
    setEditing(true);
  };

  return (
    <>
      <div className="acct-row acct-row--stack">
        <div style={{ minWidth: 0 }}>
          <div className="acct-row-label">{label}</div>
          <div className="acct-row-value" data-empty={empty ? "true" : undefined} style={{ marginTop: 3 }}>{display}</div>
          {description && <div className="acct-row-desc">{description}</div>}
        </div>
        <div className="acct-row-control">
          <button type="button" className="acct-text-btn" onClick={open} aria-label={`Edit ${label.toLowerCase()}`}>
            Edit
          </button>
        </div>
      </div>
      <FormModal
        open={editing}
        title={`Edit ${label.toLowerCase()}`}
        dirty={draft !== initial}
        onClose={() => setEditing(false)}
        onSubmit={async () => {
          const problem = validate?.(draft) ?? null;
          if (problem) {
            setError(problem);
            return false;
          }
          if (draft !== initial) await onSave(draft);
        }}
      >
        <div>
          <label htmlFor={id} className="acct-row-label" style={{ display: "block", marginBottom: 6 }}>{label}</label>
          {renderEditor({ id, value: draft, onChange: (v) => { setDraft(v); if (error) setError(null); }, invalid: !!error, describedBy: error ? errId : undefined })}
          {error && <p id={errId} className="acct-field-error">{error}</p>}
          {description && <p className="acct-row-desc" style={{ margin: "8px 0 0" }}>{description}</p>}
        </div>
      </FormModal>
    </>
  );
}
