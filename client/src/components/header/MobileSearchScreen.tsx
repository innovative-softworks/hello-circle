import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { HeaderSearch } from "./HeaderSearch";
import { ICON_STROKE } from "./headerStyles";

// Mobile search: a dedicated full-screen view (Back · field · clear), with the
// input focused and suggestions underneath. Same HeaderSearch as desktop, so
// it routes to the existing Explore search page — no second search engine.
export function MobileSearchScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Layout effect: runs before the field's autofocus (a child passive
  // effect), so the opener recorded is the Search button, not the input.
  useLayoutEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // HeaderSearch handles Escape first (clear, then close its list); an
    // Escape it didn't use closes the screen.
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const focusables = ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Portalled to <body>: the sticky header's backdrop-filter would otherwise
  // make it the containing block for position:fixed (no longer full screen).
  return createPortal(
    <div ref={ref} className="hc-search-screen" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKeyDown}>
      <div className="hc-search-screen-body">
        <HeaderSearch
          autoFocus
          inline
          onDone={onClose}
          placeholder="Search activities, circles or places…"
          before={
            <button type="button" className="hc-icon-btn" aria-label="Back" onClick={onClose}>
              <ArrowLeft size={22} strokeWidth={ICON_STROKE} />
            </button>
          }
        />
      </div>
    </div>,
    document.body
  );
}
