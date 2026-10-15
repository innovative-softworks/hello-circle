import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { zIndex } from "../theme";
import { buttonBase, buttonVariants } from "./ui";

// Anchored overflow menu (UI completion 2026-10-14) for rows and headers that
// carry several secondary actions. The main action stays a visible button
// beside it; only secondary ones go in here. WAI-ARIA menu button pattern:
// Enter/Space/ArrowDown open on the first item, ArrowUp on the last; arrows
// move (wrapping), Home/End jump, Escape closes and returns focus to the
// button, Tab closes. Positioned against the viewport (flips above the button
// when there's no room below, clamped to the screen edges). Never a drawer.

export type ActionMenuItem = {
  label: string;
  onSelect: () => void;
  /** Destructive: shown in the danger colour, after a separator. */
  danger?: boolean;
  disabled?: boolean;
};

const GAP = 4;
const EDGE = 8;

export function ActionMenu({
  label,
  items,
  buttonText = "More",
  className,
}: {
  /** Accessible name, naming the record, e.g. "More actions for Yoga in the park". */
  label: string;
  items: ActionMenuItem[];
  buttonText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const place = useCallback(() => {
    const b = buttonRef.current?.getBoundingClientRect();
    const m = menuRef.current;
    if (!b || !m) return;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = b.bottom + GAP + h <= vh - EDGE || b.top - GAP - h < EDGE;
    const top = below ? Math.min(b.bottom + GAP, vh - EDGE - h) : b.top - GAP - h;
    const left = Math.min(Math.max(EDGE, b.right - w), vw - EDGE - w);
    setPos({ top: Math.max(EDGE, top), left: Math.max(EDGE, left) });
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  const openAt = (which: "first" | "last") => {
    if (!enabled.length) return;
    setActive(which === "first" ? enabled[0] : enabled[enabled.length - 1]);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (open && pos) itemRefs.current[active]?.focus();
  }, [open, pos, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close, place]);

  const move = (delta: 1 | -1) => {
    const at = enabled.indexOf(active);
    setActive(enabled[(at + delta + enabled.length) % enabled.length]);
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Home") setActive(enabled[0]);
    else if (e.key === "End") setActive(enabled[enabled.length - 1]);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") {
      close(false);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onButtonKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openAt(e.key === "ArrowDown" ? "first" : "last");
    }
  };

  const choose = (item: ActionMenuItem) => {
    if (item.disabled) return;
    // Focus goes back to the button first, so a dialog the action opens
    // returns focus there when it closes.
    close(true);
    item.onSelect();
  };

  const firstDanger = items.findIndex((it) => it.danger);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-ghost action-menu-button${className ? ` ${className}` : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : openAt("first"))}
        onKeyDown={onButtonKey}
        style={{ ...buttonBase, ...buttonVariants.ghost, cursor: "pointer" }}
      >
        <MoreHorizontal size={16} strokeWidth={1.9} aria-hidden="true" />
        <span>{buttonText}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            className="action-menu"
            onKeyDown={onMenuKey}
            style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, zIndex: zIndex.drawer, visibility: pos ? "visible" : "hidden" }}
          >
            {items.map((item, i) => (
              <div key={item.label} role="none">
                {i === firstDanger && firstDanger > 0 && <div role="separator" className="action-menu-sep" />}
                <button
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={i === active ? 0 : -1}
                  aria-disabled={item.disabled || undefined}
                  className={`action-menu-item${item.danger ? " action-menu-item--danger" : ""}`}
                  onClick={() => choose(item)}
                  onMouseEnter={() => !item.disabled && setActive(i)}
                >
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
