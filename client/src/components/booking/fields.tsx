import { useEffect, useId, useState, type HTMLAttributes, type ReactNode } from "react";
import { BkButton } from "./BookingShell";
import { bk, bkRadius } from "./bookingTheme";

// Booking kit — form fields. Every control has a programmatic label, errors
// are tied to the control (aria-invalid + aria-describedby), inputs use 16px
// text (no iOS zoom on focus) and carry the autocomplete/keyboard hints the
// audit found missing from the booking and registration forms.

export function BkTextField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  helper,
  error,
  required,
  name,
  placeholder,
  maxLength,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "number" | "date" | "datetime-local";
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  helper?: string;
  error?: string;
  required?: boolean;
  name?: string;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const id = useId();
  const helperId = helper ? `${id}-help` : undefined;
  const errorId = error ? `${id}-err` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <label htmlFor={id} style={{ fontSize: 14, fontWeight: 600, color: bk.ink }}>
        {label}
        {!required && <span style={{ fontWeight: 400, color: bk.muted }}> (optional)</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        style={{
          height: 48,
          boxSizing: "border-box",
          width: "100%",
          padding: error ? "0 11px" : "0 12px",
          fontSize: 16,
          color: bk.ink,
          background: bk.surface,
          border: error ? `2px solid ${bk.danger}` : `1px solid ${bk.controlBorder}`,
          borderRadius: bkRadius.control,
        }}
      />
      {helper && (
        <div id={helperId} style={{ fontSize: 13, color: bk.muted }}>
          {helper}
        </div>
      )}
      {error && (
        <div id={errorId} style={{ fontSize: 13, fontWeight: 600, color: bk.danger }}>
          {error}
        </div>
      )}
    </div>
  );
}

export interface ContactValue {
  name: string;
  email: string;
  phone: string;
}

/** Who's booking. Signed in: one confirm line from the account ("Booking as
 * …" + Edit) — never empty fields for facts we already have. Guest, or after
 * Edit: labelled fields with autocomplete. Phone only when the listing asks. */
export function ContactConfirm({
  value,
  onChange,
  identity,
  askPhone = false,
  phoneRequired = false,
  phoneHelper = "Only the venue sees this.",
  errors = {},
}: {
  value: ContactValue;
  onChange: (next: ContactValue) => void;
  identity?: { name: string; email: string } | null;
  askPhone?: boolean;
  phoneRequired?: boolean;
  phoneHelper?: string;
  errors?: Partial<Record<keyof ContactValue, string>>;
}) {
  const [editing, setEditing] = useState(false);

  // Fill from the account once, without overwriting anything typed.
  useEffect(() => {
    if (identity && !value.name && !value.email) onChange({ ...value, name: identity.name, email: identity.email });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.name, identity?.email]);

  const showConfirm = !!identity && !editing && !errors.name && !errors.email && !!value.name && !!value.email;
  const set = (k: keyof ContactValue) => (v: string) => onChange({ ...value, [k]: v });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {showConfirm ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 0", borderTop: `1px solid ${bk.line}`, borderBottom: `1px solid ${bk.line}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0, textTransform: "uppercase", color: bk.muted }}>Booking as</div>
            <div style={{ fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{value.name}</div>
            <div style={{ fontSize: 14, color: bk.muted, overflowWrap: "anywhere" }}>{value.email}</div>
          </div>
          <BkButton variant="quiet" onClick={() => setEditing(true)} ariaLabel="Edit your name and email">
            Edit
          </BkButton>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <BkTextField label="Full name" value={value.name} onChange={set("name")} autoComplete="name" required error={errors.name} />
          <BkTextField label="Email" type="email" value={value.email} onChange={set("email")} autoComplete="email" inputMode="email" required error={errors.email} helper="Your confirmation goes here." />
        </div>
      )}
      {askPhone && (
        <BkTextField
          label="Phone"
          type="tel"
          value={value.phone}
          onChange={set("phone")}
          autoComplete="tel"
          inputMode="tel"
          required={phoneRequired}
          helper={phoneHelper}
          error={errors.phone}
        />
      )}
    </div>
  );
}

/** A required tick-box (terms, waiver, safety). The caller records which
 * version was accepted with the order. */
export function Acknowledgement({ checked, onChange, error, children }: { checked: boolean; onChange: (checked: boolean) => void; error?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          style={{ width: 22, height: 22, margin: "1px 0 0", accentColor: "var(--bk-ink)", flex: "none" }}
        />
        <label htmlFor={id} style={{ fontSize: 15, lineHeight: 1.4, cursor: "pointer" }}>
          {children}
        </label>
      </div>
      {error && (
        <div id={`${id}-err`} style={{ fontSize: 13, fontWeight: 600, color: bk.danger, paddingLeft: 34 }}>
          {error}
        </div>
      )}
    </div>
  );
}

/** "Have a code?" — collapsed until asked for. `onApply` resolves when the
 * server accepted the code (normally by re-quoting with it) and rejects with
 * the server's reason otherwise. */
export function CouponField({
  applied,
  onApply,
  onRemove,
  appliedProblem,
}: {
  applied: string | null;
  onApply: (code: string) => Promise<void>;
  onRemove: () => void;
  /** Commercial UX R2 — the server re-checked an applied code and it no longer
   * applies (e.g. it expired between review and pay). The quote has already
   * dropped the discount; this explains why the total went up. */
  appliedProblem?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (applied) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 15 }}>
          <span style={appliedProblem ? { textDecoration: "line-through", color: bk.muted } : undefined}>
            Code <strong>{applied}</strong> {appliedProblem ? "no longer applies" : "applied"}
          </span>
          <BkButton variant="quiet" onClick={onRemove} ariaLabel={`Remove code ${applied}`}>
            Remove
          </BkButton>
        </div>
        {appliedProblem && (
          <div role="alert" style={{ fontSize: 14, fontWeight: 600, color: bk.danger, background: bk.dangerBg, padding: "10px 12px", borderRadius: bkRadius.control }}>
            {appliedProblem}
          </div>
        )}
      </div>
    );
  }
  if (!open) {
    return (
      <BkButton variant="quiet" onClick={() => setOpen(true)} style={{ alignSelf: "flex-start" }}>
        Have a code?
      </BkButton>
    );
  }
  const apply = async () => {
    if (!code.trim()) return setError("Enter a code");
    setBusy(true);
    setError(null);
    try {
      await onApply(code.trim().toUpperCase());
      setCode("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code isn't valid");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 180px" }}>
        <BkTextField label="Code" value={code} onChange={setCode} autoComplete="off" required error={error ?? undefined} maxLength={40} autoFocus />
      </div>
      <BkButton variant="secondary" onClick={apply} busy={busy} busyLabel="Checking…" style={{ marginBottom: error ? 25 : 0 }}>
        Apply
      </BkButton>
    </div>
  );
}

/** One-of-many choice as toggle buttons (event type, duration, room). */
export function ChoiceChips<T extends string | number>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: T; label: string; hint?: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
      <legend style={{ fontSize: 14, fontWeight: 600, padding: 0, marginBottom: 10 }}>{legend}</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(o.value)}
              style={{
                minHeight: 44,
                padding: o.hint ? "8px 16px" : "0 16px",
                border: `1px solid ${selected ? bk.ink : bk.lineStrong}`,
                background: selected ? bk.ink : "transparent",
                color: selected ? bk.bg : bk.ink,
                borderRadius: bkRadius.control,
                fontSize: 15,
                fontWeight: selected ? 600 : 500,
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 2,
              }}
            >
              <span>{o.label}</span>
              {o.hint && <span style={{ fontSize: 13, fontWeight: 400, opacity: 0.85 }}>{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A bounded whole number with − / + and a typed value (party size, guests). */
export function BkNumberStepper({ label, value, onChange, min = 1, max, helper, error }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; helper?: string; error?: string }) {
  const id = useId();
  const clamp = (n: number) => Math.max(min, max !== undefined ? Math.min(max, n) : n);
  const btn = (enabled: boolean) => ({
    width: 52,
    height: 48,
    border: "none",
    background: bk.surface,
    color: bk.ink,
    fontSize: 22,
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.4,
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 14, fontWeight: 600 }}>
        {label}
      </label>
      <div style={{ display: "inline-flex", alignSelf: "flex-start", border: `1px solid ${error ? bk.danger : bk.controlBorder}`, borderRadius: bkRadius.control, overflow: "hidden" }}>
        <button type="button" aria-label={`Fewer — ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))} style={{ ...btn(value > min), borderRight: `1px solid ${bk.line}` }}>
          −
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={String(value)}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
            onChange(Number.isFinite(n) ? clamp(n) : min);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={helper || error ? `${id}-desc` : undefined}
          style={{ width: 72, height: 48, border: "none", textAlign: "center", fontSize: 17, fontWeight: 600, background: bk.surface, color: bk.ink }}
        />
        <button
          type="button"
          aria-label={`More — ${label}`}
          disabled={max !== undefined && value >= max}
          onClick={() => onChange(clamp(value + 1))}
          style={{ ...btn(max === undefined || value < max), borderLeft: `1px solid ${bk.line}` }}
        >
          +
        </button>
      </div>
      {(helper || error) && (
        <div id={`${id}-desc`} style={{ fontSize: 13, color: error ? bk.danger : bk.muted, fontWeight: error ? 600 : 400 }}>
          {error ?? helper}
        </div>
      )}
    </div>
  );
}
