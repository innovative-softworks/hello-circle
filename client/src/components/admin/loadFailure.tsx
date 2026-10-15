import { useState } from "react";
import { Button } from "../ui";
import { colors } from "../../theme";

// A failed list load must never read as "nothing here" (validation
// 2026-10-14): each section records its load failure, keeps any rows it
// already had, shows an alert with Retry and suppresses its empty copy.
export function useLoadFailure() {
  const [failed, setFailed] = useState<{ message: string; forbidden: boolean } | null>(null);
  const track = <T,>(p: Promise<T>, apply: (v: T) => void) =>
    p
      .then((v) => {
        apply(v);
        setFailed(null);
      })
      .catch((e: unknown) => {
        const status = (e as { status?: number })?.status;
        setFailed({ message: e instanceof Error && e.message ? e.message : "The request failed.", forbidden: status === 401 || status === 403 });
      });
  return { failed, track };
}

export function LoadFailed({ failed, onRetry }: { failed: { message: string } | null; onRetry: () => void }) {
  if (!failed) return null;
  return (
    <div role="alert" style={{ border: `1px solid ${colors.danger}`, background: colors.dangerBg, padding: "10px 12px", margin: "0 0 12px", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13.5 }}>
        <strong>Couldn't load this.</strong> {/[.!?]$/.test(failed.message) ? failed.message : `${failed.message}.`} What's shown below may be incomplete.
      </span>
      <Button variant="ghost" onClick={onRetry}>Try again</Button>
    </div>
  );
}
