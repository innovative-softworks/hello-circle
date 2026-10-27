import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BackLink } from "../BackLink";
import { HeartIcon } from "../icons";
import { ReportContentButton, type ReportableType } from "../ReportContentButton";
import { useSavedState } from "../SaveButton";
import { ShareButton } from "../ShareButton";
import { useToast } from "../Toast";
import { useGuest } from "../../GuestContext";
import type { ShareEntityType } from "../../api/sharing";
import type { FavoriteKind } from "../../favorites";
import { colors, radius } from "../../theme";

// Detail-page audit (2026-10-22) — one action row for every detail page:
// Back · (page extras) · Share · Save · Report. Before this each page built its
// own, and they disagreed: programmes had no Save or Report, the activity page
// saved to this browser only even for a signed-in resident (DP-06), and Back
// always went to a fixed list instead of where the person came from (DP-20).

export const detailActionStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, background: colors.surface, border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.control, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, color: colors.text, cursor: "pointer",
};

/** Back returns to the previous in-app page when there is one (keeping its
 * filters and scroll); a direct visit or a shared link falls back to the list. */
export function useDetailBack(fallback: string) {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback);
  };
}

function SaveAction({ kind, id }: { kind: FavoriteKind; id: string }) {
  const [saved, toggle] = useSavedState(kind, id);
  const { resident } = useGuest();
  const toast = useToast();
  const [noted, setNoted] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={saved}
      onClick={() => {
        toggle();
        // DP-32 — a visitor's save stays on this device until they sign in.
        if (!saved && !resident && !noted) {
          toast.info("Saved on this device. Sign in to keep it on your account.");
          setNoted(true);
        }
      }}
      style={{ ...detailActionStyle, color: saved ? colors.orange : colors.text }}
    >
      <HeartIcon size={14} filled={saved} /> {saved ? "Saved" : "Save"}
    </button>
  );
}

export function DetailTopBar({
  backTo,
  backLabel,
  share,
  save,
  report,
  extra,
}: {
  backTo: string;
  backLabel: string;
  share?: { entityType: ShareEntityType; entityId: string };
  save?: { kind: FavoriteKind; id: string };
  report?: { type: ReportableType; id: string; what: string };
  /** Page-specific actions shown before Share (chat, invite, follow). */
  extra?: ReactNode;
}) {
  const back = useDetailBack(backTo);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
      <span className="detail-back">
        <BackLink onClick={back} marginBottom={0}>{backLabel}</BackLink>
      </span>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {extra}
        {share && <ShareButton entityType={share.entityType} entityId={share.entityId} render={(onClick) => <button type="button" onClick={onClick} style={detailActionStyle}>Share</button>} />}
        {save && <SaveAction kind={save.kind} id={save.id} />}
        {report && (
          <ReportContentButton
            targetType={report.type}
            targetId={report.id}
            what={report.what}
            render={(onClick, done) => (
              <button type="button" onClick={onClick} disabled={done} style={detailActionStyle}>
                {done ? "Reported" : "Report"}
              </button>
            )}
          />
        )}
      </div>
    </div>
  );
}
