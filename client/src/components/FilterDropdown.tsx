import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";
import { colors } from "../theme";

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
  children,
}: {
  label: ReactNode;
  /** Whether to paint the trigger in its "something is selected" state. */
  active?: boolean;
  accent?: "green" | "orange";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const accentColor = accent === "orange" ? colors.orange : colors.green;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          border: `1.5px solid ${active ? accentColor : colors.borderStrong}`,
          background: active ? accentColor : "#fff",
          color: active ? "#fff" : "#3B423C",
          borderRadius: 20,
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
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            background: "#fff",
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
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
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: active ? colors.greenBg : "none",
        border: "none",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 14,
        fontWeight: active ? 700 : 500,
        color: active ? colors.greenText : "#3B423C",
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
    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", fontSize: 13.5, color: "#3B423C", cursor: "pointer", borderRadius: 8 }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
