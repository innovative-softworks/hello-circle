import { useState } from "react";
import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";
import { switchWorkspace } from "../../api";
import { useGuest } from "../../GuestContext";
import { AdminButton, IconTile, errorMessage } from "../admin/adminUi";
import type { AuthUser } from "../../types";

// OG-01 / DEC-03 — the Host workspace (and Circle management) runs on the
// person's personal (resident) account. A partner whose business account is
// linked to a personal account, but who is only signed in as the business, is
// offered an explicit switch here instead of being bounced to /vendor or sent
// to sign in again. Nothing switches without the click; after it, the page they
// asked for (including ?tab= and ?record=) simply renders.

export function PersonalAccountGate({ user, what = "Hosting" }: { user: AuthUser; what?: string }) {
  const { refresh } = useGuest();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await switchWorkspace("resident");
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Couldn't switch to your personal account. Try again."));
      setBusy(false);
    }
  };

  return (
    <div className="adm" style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "48px 16px" }}>
      <div className="adm-box" style={{ maxWidth: 460, width: "100%", padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
        <IconTile icon={UserRound} />
        <h1 style={{ fontFamily: "var(--adm-display)", fontSize: 22, margin: 0 }}>{what} uses your personal account</h1>
        <p style={{ margin: 0, color: "var(--adm-muted)" }}>
          You're signed in as {user.businessName || user.name}. Your business account is linked to a personal HelloCircle account; switch to it to continue. You can switch back from the account menu at any time.
        </p>
        {error && (
          <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <AdminButton variant="primary" onClick={switchNow} disabled={busy}>
            {busy ? "Switching…" : "Switch to personal account"}
          </AdminButton>
          <Link to="/vendor" className="adm-btn adm-btn--quiet">
            Back to Partner workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
