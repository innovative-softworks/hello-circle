import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";
import { colors, radius } from "../theme";

// A single reusable "chip that opens a panel" — replaces the pattern of
// dumping every option as its own inline chip (Browse.tsx's county/
// amenities/accessibility rows used to do this, and with 16 counties + 25
// amenities the filter bar grew to 4 wrapped rows before a single result
// was visible). Same open/close-on-outside-click convention Header.tsx's
// own dropdowns already use, just generalized into one component instead
// of copy-pasted per menu.

export function FilterDropdown({
  label,
  active,
  accent = "green",
  align = "left",
  closeOnSelect = false,
  floating = false,
  children,
}: {
  label: ReactNode;
  /** Whether to paint the trigger in its "something is selected" state. */
  active?: boolean;
  accent?: "green" | "orange";
  /** "right" for a trigger near the right edge, so the panel opens inward. */
  align?: "left" | "right";
  /** Close once an option button is picked (single-choice menus). */
  closeOnSelect?: boolean;
  /** Open the panel at a fixed screen position, for a trigger inside a
   * sideways-scrolling row (which would otherwise clip it). It follows its
   * button when the page or row scrolls. */
  floating?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Sideways nudge so the panel never opens past the screen edge (phones).
  const [nudge, setNudge] = useState(0);
  const [fixedAt, setFixedAt] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !floating || !triggerRef.current) return setFixedAt(null);
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setFixedAt({ top: r.bottom + 6, left: align === "right" ? r.right : r.left });
    };
    place();
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) place();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, floating, align]);
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return setNudge(0);
    const r = panelRef.current.getBoundingClientRect();
    const gutter = 8;
    // Measured with the current nudge applied, so undo it first.
    setNudge((prev) => {
      const left = r.left - prev;
      const right = r.right - prev;
      if (left < gutter) return gutter - left;
      if (right > window.innerWidth - gutter) return window.innerWidth - gutter - right;
      return 0;
    });
  }, [open, fixedAt]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Escape closes the panel and hands focus back to its button.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  void accent; // selected = forest pill everywhere (design-system pass)

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="btn"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          border: `1.5px solid ${active ? colors.dark : colors.borderStrong}`,
          background: active ? colors.dark : colors.surface,
          color: active ? colors.onNight : colors.textSoft,
          borderRadius: radius.pill,
          padding: "8px 14px",
          fontSize: 14,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <ChevronDownIcon size={13} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s ease" }} />
      </button>
      {open && (
        <div
          ref={panelRef}
          onClick={
            closeOnSelect
              ? (e) => {
                  if (!(e.target as HTMLElement).closest("button")) return;
                  setOpen(false);
                  triggerRef.current?.focus();
                }
              : undefined
          }
          style={{
            ...(floating && fixedAt
              ? { position: "fixed" as const, top: fixedAt.top, left: fixedAt.left, transform: `translateX(calc(${align === "right" ? "-100%" : "0px"} + ${nudge}px))` }
              : {
                  position: "absolute" as const,
                  top: "calc(100% + 6px)",
                  ...(align === "right" ? { right: 0 } : { left: 0 }),
                  transform: nudge ? `translateX(${nudge}px)` : undefined,
                }),
            zIndex: 30,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.card,
            padding: 8,
            minWidth: 230,
            maxHeight: 320,
            overflowY: "auto",
            boxShadow: "0 12px 32px rgba(30,40,32,.16)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A single selectable row inside a FilterDropdown's panel (radio-style —
 * one active option at a time, e.g. county/sport). */
export function DropdownOption({ label, active, onClick }: { label: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: active ? colors.orangeBg : "none",
        border: "none",
        borderRadius: radius.control,
        padding: "8px 10px",
        fontSize: 14,
        fontWeight: active ? 700 : 500,
        color: active ? colors.text : colors.textSoft,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

/** A checkbox row inside a FilterDropdown's panel (multi-select, e.g.
 * amenities/accessibility — every checked box must match, AND not OR). */
export function DropdownCheckbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", fontSize: 14, fontWeight: checked ? 700 : 500, color: checked ? colors.text : colors.textSoft, cursor: "pointer", borderRadius: radius.control }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ width: 16, height: 16, margin: 0, flex: "none", accentColor: "var(--color-text)" }} />
      {label}
    </label>
  );
}
