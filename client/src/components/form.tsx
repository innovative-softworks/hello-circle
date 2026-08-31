import { useEffect, useId, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { MinusIcon, PlusIcon } from "./icons";
import { ConfirmDialog } from "./ui";
import { colors, fonts, radius } from "../theme";

// Shared form primitives (Form System Audit, Phase 2) — every form in the
// app previously hand-rolled `<label style={labelStyle}><input
// style={inputStyle}>` per call site (see ui.tsx's inputStyle/labelStyle),
// which is how field width, helper text and inline errors ended up
// inconsistent across Centre/Club/Program/Experience/Game/Circle forms.
// These wrap that same visual language (same colors/radius/font-size as
// ui.tsx's inputStyle) behind one component per concern instead of
// reintroducing a competing style system.

const baseControlStyle: CSSProperties = {
  padding: "11px 13px",
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 11,
  fontSize: 14,
  background: colors.surface,
  color: colors.text,
  outline: "none",
  transition: "border-color .15s ease, box-shadow .15s ease",
};

const WIDTH_PX: Record<"xs" | "sm" | "md" | "full", string> = {
  xs: "80px",
  sm: "140px",
  md: "260px",
  full: "100%",
};

// --- Field — label + helper + inline error, one width contract ------------
// `width` matches the field to its data (spec #13 — a 2-digit capacity
// field shouldn't be as wide as a description) instead of every field
// defaulting to 100%.

export function Field({
  label,
  helper,
  error,
  width = "full",
  htmlFor,
  children,
  style,
}: {
  label: string;
  helper?: string;
  error?: string;
  /** "xs" (short numbers/codes), "sm" (short words), "md" (names/emails),
   * "full" (descriptions, addresses, search) — default "full" so existing
   * call sites that don't pass this stay visually unchanged. */
  width?: "xs" | "sm" | "md" | "full";
  htmlFor?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ width: WIDTH_PX[width], maxWidth: "100%", ...style }}>
      <label htmlFor={htmlFor} style={{ display: "block", fontSize: 12, fontWeight: 600, color: colors.muted, margin: "0 0 6px", letterSpacing: ".01em" }}>
        {label}
      </label>
      {helper && <p style={{ fontSize: 12, color: colors.mutedLight, margin: "-2px 0 7px", lineHeight: 1.5 }}>{helper}</p>}
      {children}
      {error && <p style={{ fontSize: 12, color: colors.danger, margin: "6px 0 0", fontWeight: 600 }}>{error}</p>}
    </div>
  );
}

// --- TextInput / TextArea ---------------------------------------------------

export function TextInput({
  label,
  helper,
  error,
  width = "full",
  style,
  ...inputProps
}: {
  label: string;
  helper?: string;
  error?: string;
  width?: "xs" | "sm" | "md" | "full";
  style?: CSSProperties;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "style">) {
  const id = useId();
  return (
    <Field label={label} helper={helper} error={error} width={width} htmlFor={id}>
      <input
        id={id}
        {...inputProps}
        style={{ ...baseControlStyle, width: "100%", borderColor: error ? colors.danger : colors.inputBorder, ...style }}
      />
    </Field>
  );
}

export function TextArea({
  label,
  helper,
  error,
  maxLength,
  value,
  style,
  ...textareaProps
}: {
  label: string;
  helper?: string;
  error?: string;
  value: string;
  style?: CSSProperties;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "style" | "value">) {
  const id = useId();
  return (
    <Field label={label} helper={helper} error={error} width="full" htmlFor={id}>
      <textarea
        id={id}
        value={value}
        maxLength={maxLength}
        {...textareaProps}
        style={{ ...baseControlStyle, width: "100%", resize: "vertical", borderColor: error ? colors.danger : colors.inputBorder, ...style }}
      />
      {maxLength !== undefined && (
        <div style={{ textAlign: "right", fontSize: 11, color: colors.faint, marginTop: 4 }}>
          {value.length} / {maxLength}
        </div>
      )}
    </Field>
  );
}

// --- NumberStepper — for small bounded ranges (capacity, party size) ------
// A raw <input type="number"> reads as an administrative control; a
// question this small ("How many people can join?") is better answered
// with a direct +/- than a text field you have to click into and type in.

export function NumberStepper({
  label,
  helper,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
}: {
  label: string;
  helper?: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(max !== undefined ? Math.min(max, value + step) : value + step);
  const btnStyle: CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: `1px solid ${colors.borderStrong}`,
    background: colors.surface,
    color: colors.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flex: "none",
  };
  return (
    <Field label={label} helper={helper} width="sm">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button type="button" onClick={dec} disabled={value <= min} aria-label="Decrease" style={{ ...btnStyle, opacity: value <= min ? 0.4 : 1, cursor: value <= min ? "default" : "pointer" }}>
          <MinusIcon size={14} />
        </button>
        <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "inherit", minWidth: 22, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <button type="button" onClick={inc} disabled={max !== undefined && value >= max} aria-label="Increase" style={{ ...btnStyle, opacity: max !== undefined && value >= max ? 0.4 : 1, cursor: max !== undefined && value >= max ? "default" : "pointer" }}>
          <PlusIcon size={14} />
        </button>
      </div>
    </Field>
  );
}

// --- ChoiceCards — for 2-6 meaningful categorical decisions ----------------
// Reserved for important low-option decisions (spec #11) — don't reach for
// this over a <select> for long lists (counties, categories with 15+ values).

export function ChoiceCards<T extends string>({
  label,
  helper,
  value,
  onChange,
  options,
  columns,
}: {
  label?: string;
  helper?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; title: string; subtitle?: string; icon?: ReactNode }[];
  columns?: number;
}) {
  const body = (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns ?? Math.min(options.length, 2)}, 1fr)`, gap: 10 }} className="grid-responsive">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              textAlign: "left",
              padding: "14px 16px",
              borderRadius: radius.control,
              border: `1.5px solid ${active ? colors.green : colors.border}`,
              background: active ? colors.greenBg : colors.surface,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: active ? colors.greenText : colors.text }}>
              {opt.icon}
              {opt.title}
            </span>
            {opt.subtitle && <span style={{ fontSize: 12.5, color: colors.mutedLight }}>{opt.subtitle}</span>}
          </button>
        );
      })}
    </div>
  );
  if (!label) return body;
  return (
    <Field label={label} helper={helper} width="full">
      {body}
    </Field>
  );
}

// --- RadioGroup — for 2-5 simple choices -----------------------------------

export function RadioGroup<T extends string>({
  label,
  helper,
  value,
  onChange,
  options,
}: {
  label: string;
  helper?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <Field label={label} helper={helper} width="full">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <label
              key={opt.value}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 14px",
                borderRadius: radius.pill,
                border: `1.5px solid ${active ? colors.green : colors.border}`,
                background: active ? colors.greenBg : colors.surface,
                color: active ? colors.greenText : colors.text,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <input type="radio" checked={active} onChange={() => onChange(opt.value)} style={{ accentColor: colors.green, margin: 0 }} />
              {opt.label}
            </label>
          );
        })}
      </div>
    </Field>
  );
}

// --- CheckboxGroup — grouped multi-select for a short visible list ---------
// Spec #36 — a dropdown multi-select is worse than plain checkboxes once
// the list is short enough to show in full (amenities, accessibility).

export function CheckboxGroup({
  label,
  helper,
  value,
  onChange,
  options,
  columns = 2,
}: {
  label: string;
  helper?: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: string[];
  columns?: number;
}) {
  const toggle = (opt: string) => onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  return (
    <Field label={label} helper={helper} width="full">
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: "8px 14px" }}>
        {options.map((opt) => (
          <label key={opt} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, color: colors.text, cursor: "pointer" }}>
            <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} style={{ accentColor: colors.green, width: 16, height: 16 }} />
            {opt}
          </label>
        ))}
      </div>
    </Field>
  );
}

// --- FormErrorSummary — jump-to-field, for long forms on submit failure ----
// Replaces the flat "Missing required fields" string every editor's catch
// block currently surfaces verbatim from the server.

export function FormErrorSummary({ errors }: { errors: { field: string; message: string; fieldId?: string }[] }) {
  if (errors.length === 0) return null;
  const jump = (fieldId?: string) => {
    if (!fieldId) return;
    const el = document.getElementById(fieldId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus();
  };
  return (
    <div style={{ border: `1px solid ${colors.danger}`, background: colors.dangerBg, borderRadius: radius.control, padding: "12px 16px", marginBottom: 16 }}>
      <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13.5, color: colors.danger }}>
        {errors.length === 1 ? "There's 1 thing to fix" : `There are ${errors.length} things to fix`}
      </p>
      <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
        {errors.map((e) => (
          <li key={e.field} style={{ fontSize: 13, marginBottom: 2 }}>
            {e.fieldId ? (
              <button type="button" onClick={() => jump(e.fieldId)} style={{ background: "none", border: "none", padding: 0, color: colors.danger, textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
                {e.message}
              </button>
            ) : (
              <span style={{ color: colors.danger }}>{e.message}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- SettingsSection — summary + Edit, for editing something that already
// exists (Form System Audit, Phase 3). Spec §15/16: don't force a vendor
// back through a 13-field scroll just to change the phone number — show a
// one-line summary per section, expand only the one they click Edit on.
// This controls *visibility*, not save scope — Save still commits the whole
// form; sections aren't independently persisted (that's a separate,
// larger change to how these forms save).

export function SettingsSection({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: `1px solid ${colors.border}`, padding: "18px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 13, letterSpacing: ".04em", textTransform: "uppercase", color: colors.muted, margin: "0 0 8px" }}>
            {title}
          </h4>
          {!open && <div style={{ fontSize: 14, color: colors.text, lineHeight: 1.5 }}>{summary}</div>}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, fontSize: 13, cursor: "pointer", flex: "none", whiteSpace: "nowrap" }}
        >
          {open ? "Done" : "Edit →"}
        </button>
      </div>
      {open && <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>}
    </div>
  );
}

// --- useUnsavedChangesGuard — protect real form work from a stray click
// away (Form System Audit, Phase 4). Two layers, matching what's actually
// achievable without migrating off plain BrowserRouter to a data router
// (which useBlocker/unstable_useBlocker require):
//  1. `beforeunload` — catches a tab close, refresh, or typed-URL navigation.
//  2. `requestNavigation` — call this instead of `navigate(...)` from a
//     form's own Back/Cancel button; it interposes a ConfirmDialog when
//     dirty, and calls the navigation straight through when not.
// This does NOT catch clicking an unrelated header/nav link elsewhere on
// the page — only the exit points a form explicitly wires through it.

export function useUnsavedChangesGuard(isDirty: boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const requestNavigation = (action: () => void) => {
    if (isDirty) setPending(() => action);
    else action();
  };

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title="Leave without saving?"
      message="You have unsaved changes. If you leave now, they'll be lost."
      confirmLabel="Leave without saving"
      cancelLabel="Keep editing"
      onConfirm={() => {
        pending?.();
        setPending(null);
      }}
      onCancel={() => setPending(null)}
    />
  );

  return { requestNavigation, dialog };
}
