import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { colors, zIndex } from "../theme";
import { CloseIcon } from "./icons";

// Non-blocking feedback only ("Changes saved", "Link copied"). Blocking or
// form-level failures belong inline (field error / FormErrorSummary), because a
// toast disappears — never put the only copy of important information here.
//
// Two live regions, always mounted (a live region added at the same moment as
// its content is often not announced): `status`/polite for confirmations,
// `alert`/assertive for a failed background action.

type ToastKind = "success" | "info" | "error";
type ToastItem = { id: number; kind: ToastKind; message: string };

const DURATION: Record<ToastKind, number> = { success: 4000, info: 5000, error: 8000 };

type ToastApi = { success: (m: string) => void; info: (m: string) => void; error: (m: string) => void };
const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const tone = toast.kind === "error" ? { bg: colors.dangerBg, fg: colors.danger } : toast.kind === "success" ? { bg: colors.greenBg, fg: colors.greenText } : { bg: colors.panel, fg: colors.text };
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(toast.id), DURATION[toast.kind]);
    return () => window.clearTimeout(t);
  }, [toast.id, toast.kind, onDismiss]);
  return (
    <div
      className="pop-in"
      style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 420, width: "100%", background: tone.bg, color: tone.fg, border: `1px solid ${colors.border}`, borderRadius: "var(--r-card)", boxShadow: "var(--shadow-overlay)", padding: "12px 12px 12px 16px", fontSize: 14, fontWeight: 600 }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", width: 44, height: 44, margin: "-8px 0", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((kind: ToastKind, message: string) => {
    setToasts((t) => {
      // Same message already showing → don't stack duplicates.
      if (t.some((x) => x.kind === kind && x.message === message)) return t;
      return [...t.slice(-2), { id: nextId.current++, kind, message }];
    });
  }, []);

  const api = useMemo<ToastApi>(() => ({ success: (m) => push("success", m), info: (m) => push("info", m), error: (m) => push("error", m) }), [push]);
  const polite = toasts.filter((t) => t.kind !== "error");
  const assertive = toasts.filter((t) => t.kind === "error");

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-region" style={{ zIndex: zIndex.toast }}>
          <div role="status" aria-live="polite" style={{ display: "contents" }}>
            {polite.map((t) => (
              <ToastView key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </div>
          <div role="alert" style={{ display: "contents" }}>
            {assertive.map((t) => (
              <ToastView key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </div>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
