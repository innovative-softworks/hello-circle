import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fetchCategoryOptions, DISCOVERY_TAG_LABELS, type CategoryFamily, type DiscoveryTag, type ListingTaxonomy, type PickerCategory } from "../../api";
import { colors, radius } from "../../theme";
import { inputStyle } from "../ui";

// Category system (docs/hellocircle-category-ux-ui-spec.md) — one searchable
// field instead of two long dropdowns: typing "badm" offers
// "Badminton — Racket sports"; choosing a subcategory sets its category too.
// Only categories valid for the listing type are offered (the server checks
// again). Optional in the first release. ARIA combobox pattern, same as the
// header search.

export interface CategoryValue {
  categoryId: string;
  subcategoryId: string | null;
}

interface Option {
  key: string;
  categoryId: string;
  subcategoryId: string | null;
  label: string;
  hint: string;
  search: string;
  /** Listed before anything is typed (top-level categories, and the subcategories of one that needs a subcategory). */
  top: boolean;
}

function buildOptions(categories: PickerCategory[]): Option[] {
  const out: Option[] = [];
  for (const c of categories) {
    // Phase E — when the organisation may only use some subcategories, the category itself isn't a choice.
    if (!c.subcategoryRequired) out.push({ key: c.id, categoryId: c.id, subcategoryId: null, label: c.name, hint: c.description ?? "Any", search: `${c.name} ${c.description ?? ""}`.toLowerCase(), top: true });
    for (const s of c.subcategories) {
      out.push({ key: `${c.id}/${s.id}`, categoryId: c.id, subcategoryId: s.id, label: s.name, hint: c.name, search: `${s.name} ${c.name}`.toLowerCase(), top: !!c.subcategoryRequired });
    }
  }
  return out;
}

export function describeCategory(categories: PickerCategory[], value: CategoryValue | null, current?: ListingTaxonomy | null): { name: string; sub: string | null; retired: boolean } | null {
  if (!value) return null;
  const c = categories.find((x) => x.id === value.categoryId);
  const s = c?.subcategories.find((x) => x.id === value.subcategoryId);
  if (c) {
    const subMissing = !!value.subcategoryId && !s;
    return { name: c.name, sub: s?.name ?? (subMissing ? current?.subcategoryName ?? null : null), retired: subMissing };
  }
  // Saved on the listing but no longer offered (deactivated or archived).
  if (current && current.categoryId === value.categoryId) return { name: current.categoryName, sub: current.subcategoryName, retired: true };
  return { name: value.categoryId, sub: value.subcategoryId, retired: true };
}

export function useCategoryOptions(family: CategoryFamily, scope?: "partner") {
  const [state, setState] = useState<{ enabled: boolean; categories: PickerCategory[]; loaded: boolean; failed: boolean }>({ enabled: true, categories: [], loaded: false, failed: false });
  const load = () => {
    setState((s) => ({ ...s, failed: false }));
    fetchCategoryOptions(family, scope)
      .then((o) => setState({ enabled: o.enabled, categories: o.categories, loaded: true, failed: false }))
      .catch(() => setState((s) => ({ ...s, loaded: true, failed: true })));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [family, scope]);
  return { ...state, reload: load };
}

export function CategoryPicker({
  family,
  value,
  onChange,
  current,
  categories: given,
  label = "Category",
  hint,
  id,
  error,
  scope,
}: {
  family: CategoryFamily;
  /** Phase E — "partner" on partner listing forms: only the organisation's allowed categories. */
  scope?: "partner";
  value: CategoryValue | null;
  onChange: (next: CategoryValue | null, picked?: { label: string; categoryName: string }) => void;
  /** The listing's saved classification, so a retired category still has a name. */
  current?: ListingTaxonomy | null;
  /** Pass to skip the fetch (e.g. the vendor endpoint already returned them). */
  categories?: PickerCategory[];
  label?: string;
  hint?: string;
  id?: string;
  error?: string;
}) {
  const fetched = useCategoryOptions(family, scope);
  const categories = given ?? fetched.categories;
  const options = useMemo(() => buildOptions(categories), [categories]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const inputId = id ?? `${baseId}-input`;
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;

  const q = query.trim().toLowerCase();
  const filtered = (q ? options.filter((o) => o.search.includes(q)) : options.filter((o) => o.top)).slice(0, 40);
  const selected = describeCategory(categories, value, current);

  if (!given && !fetched.enabled) return null;

  const pick = (o: Option) => {
    onChange({ categoryId: o.categoryId, subcategoryId: o.subcategoryId }, { label: o.label, categoryName: o.subcategoryId ? o.hint : o.label });
    setQuery("");
    setOpen(false);
    setActive(-1);
    setEditing(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && filtered[active]) {
        e.preventDefault();
        pick(filtered[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (editing && value) {
        setEditing(false);
      }
    }
  };

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const showList = open && filtered.length > 0;
  const showSearch = !selected || editing;

  return (
    <div ref={wrapRef} onBlur={(e) => !wrapRef.current?.contains(e.relatedTarget as Node | null) && setOpen(false)}>
      <label htmlFor={inputId} style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
        {label} <span style={{ fontWeight: 400, color: colors.muted }}>(optional)</span>
      </label>
      {hint && (
        <p id={hintId} style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 8px" }}>
          {hint}
        </p>
      )}
      {selected && !editing && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
            padding: "10px 12px",
            borderRadius: radius.control,
            border: `1px solid ${selected.retired ? colors.danger : colors.green}`,
            background: selected.retired ? colors.dangerBg : colors.greenBg,
          }}
        >
          <span style={{ fontSize: 14, color: colors.text }}>
            <strong>{selected.sub ?? selected.name}</strong>
            {selected.sub && <span style={{ color: colors.muted }}> — {selected.name}</span>}
            {selected.retired && <span style={{ display: "block", fontSize: 12.5, color: colors.danger, marginTop: 2 }}>No longer offered — choose another category.</span>}
          </span>
          <span style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              className="btn-reset"
              style={{ fontSize: 13, fontWeight: 700, textDecoration: "underline", color: colors.text }}
              onClick={() => {
                setEditing(true);
                setOpen(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              Change
            </button>
            <button type="button" className="btn-reset" style={{ fontSize: 13, color: colors.muted, textDecoration: "underline" }} onClick={() => onChange(null)}>
              Remove
            </button>
          </span>
        </div>
      )}
      {showSearch && (
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={query}
            placeholder="Search: badminton, hiking, pottery…"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? `${baseId}-${filtered[active]?.key}` : undefined}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            style={{ ...inputStyle, borderColor: error ? colors.danger : undefined }}
          />
          {showList && (
            <div
              id={listId}
              role="listbox"
              aria-label={`${label} options`}
              style={{
                position: "absolute",
                zIndex: 30,
                left: 0,
                right: 0,
                top: "calc(100% + 4px)",
                maxHeight: 300,
                overflowY: "auto",
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: radius.control,
                boxShadow: "0 8px 24px rgba(23, 32, 25, 0.12)",
                padding: 4,
              }}
            >
              {filtered.map((o, i) => (
                <div
                  key={o.key}
                  id={`${baseId}-${o.key}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    padding: "9px 10px",
                    borderRadius: radius.control,
                    cursor: "pointer",
                    background: i === active ? colors.greenBg : "transparent",
                    minHeight: 40,
                  }}
                >
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: colors.text }}>{o.label}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: colors.muted }}>{o.subcategoryId ? o.hint : "Any type"}</span>
                </div>
              ))}
            </div>
          )}
          {open && q && filtered.length === 0 && (
            <p role="status" style={{ fontSize: 12.5, color: colors.muted, margin: "6px 0 0" }}>
              Nothing matches "{query.trim()}". Try a broader word, or leave the category empty — you can add it later.
            </p>
          )}
          {!given && fetched.failed && (
            <p role="alert" style={{ fontSize: 12.5, color: colors.danger, margin: "6px 0 0" }}>
              Couldn't load categories.{" "}
              <button type="button" className="btn-reset" style={{ textDecoration: "underline", fontWeight: 700 }} onClick={fetched.reload}>
                Try again
              </button>
            </p>
          )}
          {editing && selected && (
            <button type="button" className="btn-reset" style={{ fontSize: 12.5, marginTop: 6, textDecoration: "underline", color: colors.muted }} onClick={() => setEditing(false)}>
              Keep {selected.sub ?? selected.name}
            </button>
          )}
        </div>
      )}
      {error && (
        <p id={errorId} role="alert" style={{ fontSize: 12.5, color: colors.danger, margin: "6px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Optional descriptive tags — compact toggle pills (real checkboxes for keyboard and screen readers). */
export function TagPicker({ value, onChange, label = "Tags" }: { value: string[]; onChange: (next: string[]) => void; label?: string }) {
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 8, padding: 0 }}>
        {label} <span style={{ fontWeight: 400, color: colors.muted }}>(optional)</span>
      </legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {(Object.keys(DISCOVERY_TAG_LABELS) as DiscoveryTag[]).map((t) => {
          const on = value.includes(t);
          return (
            <label
              key={t}
              className="hc-tag-toggle"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minHeight: 36,
                padding: "6px 12px",
                borderRadius: radius.pill,
                border: `1px solid ${on ? colors.green : colors.border}`,
                background: on ? colors.greenBg : colors.surface,
                fontSize: 13,
                fontWeight: on ? 700 : 500,
                color: colors.text,
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(t)} style={{ margin: 0 }} />
              {DISCOVERY_TAG_LABELS[t]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
