import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ui";

// App-wide confirmation popup — `const confirm = useConfirm();` then
// `if (!(await confirm({ title, message, confirmLabel }))) return;` at the
// top of any handler whose action is hard to undo or affects other people
// (joining/leaving, declining, removing, pausing, submitting). One
// ConfirmDialog rendered here, instead of an open-state + <ConfirmDialog>
// pair in every component. Components that already manage their own
// ConfirmDialog (with extra content like a reason picker) keep doing so.

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" (red) for destructive actions; "neutral" for joins, sends, submits. */
  tone?: "danger" | "neutral";
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    // A second request while one is open resolves the first as "cancel".
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { ...opts, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = (ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={!!pending}
        title={pending?.title ?? ""}
        message={pending?.message ?? ""}
        confirmLabel={pending?.confirmLabel ?? "Confirm"}
        cancelLabel={pending?.cancelLabel ?? "Cancel"}
        tone={pending?.tone ?? "neutral"}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

/** Falls back to window.confirm outside the provider (e.g. an isolated render). */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  return ctx ?? (async (opts) => window.confirm(`${opts.title}\n\n${typeof opts.message === "string" ? opts.message : ""}`));
}
