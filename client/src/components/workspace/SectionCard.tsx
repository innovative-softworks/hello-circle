import { useEffect, useState, type ReactNode } from "react";
import {
  Accessibility,
  Clock,
  Euro,
  Images,
  ListChecks,
  MapPin,
  Mountain,
  PenLine,
  Phone,
  Route,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { AdminButton, AdminModal } from "../admin/adminUi";
import type { SectionSave } from "./sectionSave";
import { FormErrorSummary, RequiredNote } from "../form";

// A SettingsSection as a workspace card: icon, title, summary and one Edit
// (or Add, when nothing is filled in yet) button that opens the fields in a
// popup. Saving the popup saves the whole form through the editor's
// SectionSave, the same single save the old page-level button used.

const ICONS: [RegExp, LucideIcon][] = [
  [/general|about/i, PenLine],
  [/location|meeting/i, MapPin],
  [/contact/i, Phone],
  [/booking|opening|hours/i, Clock],
  [/amenit/i, Sparkles],
  [/accessib/i, Accessibility],
  [/photo/i, Images],
  [/pric|membership/i, Euro],
  [/included|itinerary|bring/i, ListChecks],
  [/participation/i, Users],
  [/adventure/i, Mountain],
  [/logistic|safety/i, ShieldCheck],
  [/session|route/i, Route],
];

export function iconForSection(title: string): LucideIcon {
  return ICONS.find(([re]) => re.test(title))?.[1] ?? PenLine;
}

/** A summary that says nothing has been added yet. */
export function looksMissing(summary: ReactNode): boolean {
  return typeof summary === "string" && /^(not added|none added|not set|0 photos|0 of )/i.test(summary.trim());
}

export function SectionCard({
  title,
  summary,
  children,
  ctx,
  hasErrors,
  fieldIds,
  missing,
}: {
  title: string;
  summary: ReactNode;
  children: ReactNode;
  ctx: SectionSave;
  /** A field inside failed the last save: the card is marked until it's fixed. */
  hasErrors?: boolean;
  fieldIds?: string[];
  missing?: boolean;
}) {
  const [open, setOpenState] = useState(false);
  const isMissing = missing ?? looksMissing(summary);
  const Icon = iconForSection(title);
  const matches = (key: string | null | undefined) => !!key && (key === title || (key.startsWith("field:") && !!fieldIds?.includes(key.slice(6))));
  const setOpen = (v: boolean) => {
    if (v && !open) ctx.begin?.();
    setOpenState(v);
    if (!v && matches(ctx.openKey)) ctx.setOpenKey?.(null);
  };
  // The readiness rail's "Add", or an error-summary link in another section's
  // popup, names this section: open it. Another section being named closes
  // this one, keeping what was typed (it's saved together with the rest).
  useEffect(() => {
    if (matches(ctx.openKey)) {
      if (!open) {
        ctx.begin?.();
        setOpenState(true);
      }
    } else if (ctx.openKey && open) {
      setOpenState(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.openKey]);

  const save = async () => {
    if (await ctx.save()) setOpen(false);
  };
  const cancel = () => {
    ctx.cancel?.();
    setOpen(false);
  };

  return (
    <section className="ws-sec" data-missing={isMissing || undefined} data-error={hasErrors || undefined} aria-label={title}>
      <div className="ws-sec-head">
        <span className="adm-itile" aria-hidden="true">
          <Icon size={17} strokeWidth={1.9} />
        </span>
        <h2 className="ws-sec-title">{title}</h2>
        <AdminButton size="sm" variant={isMissing ? "primary" : "secondary"} onClick={() => setOpen(true)} aria-label={`${isMissing ? "Add" : "Edit"} ${title.toLowerCase()}`}>
          {isMissing ? "Add" : "Edit"}
        </AdminButton>
      </div>
      <div className="ws-sec-body">{isMissing ? <span className="adm-chip" data-tone="warn">Missing</span> : summary}</div>
      <AdminModal
        open={open}
        onClose={cancel}
        title={title}
        wide
        dirty={open && !!ctx.isDirty?.()}
        footer={
          <>
            <AdminButton variant="quiet" onClick={cancel}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" onClick={save} disabled={ctx.saving} aria-busy={ctx.saving || undefined}>
              {ctx.saving ? "Saving…" : "Save"}
            </AdminButton>
          </>
        }
      >
        {fieldIds && fieldIds.length > 0 && <RequiredNote />}
        <FormErrorSummary errors={ctx.errors} focusKey={ctx.focusKey} onMissingField={(id) => ctx.setOpenKey?.(`field:${id}`)} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
      </AdminModal>
    </section>
  );
}

/** Right-hand rail: how complete the listing is, and how it looks. */
export function ReadinessRail({
  checks,
  preview,
  onFix,
}: {
  checks: { label: string; done: boolean; section?: string }[];
  preview?: { image?: string | null; title: string; meta: string; icon?: LucideIcon };
  onFix?: (section: string) => void;
}) {
  const done = checks.filter((c) => c.done).length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 100;
  const PreviewIcon = preview?.icon;
  return (
    <aside className="ws-rail">
      <div className="adm-box ws-rail-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong>Profile {pct}% complete</strong>
          <span className="adm-note">
            {done}/{checks.length}
          </span>
        </div>
        <div className="ws-meter" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <ul className="ws-checks">
          {checks.map((c) => (
            <li key={c.label} data-done={c.done || undefined}>
              <span aria-hidden="true">{c.done ? "✓" : "○"}</span>
              <span>
                {c.label}
                <span className="adm-visually-hidden">{c.done ? " — done" : " — not done yet"}</span>
              </span>
              {!c.done && c.section && onFix && (
                <button type="button" className="adm-linkish" onClick={() => onFix(c.section!)}>
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {preview && (
        <div className="adm-box ws-rail-card">
          <strong style={{ fontSize: 13 }}>How people see it</strong>
          {preview.image ? (
            <img src={preview.image} alt="" className="ws-rail-img" />
          ) : (
            <div className="ws-rail-img ws-thumb--empty">{PreviewIcon && <PreviewIcon size={26} strokeWidth={1.6} aria-hidden="true" />}</div>
          )}
          <strong style={{ display: "block", marginTop: 10 }}>{preview.title}</strong>
          <span className="adm-note">{preview.meta}</span>
        </div>
      )}
    </aside>
  );
}
