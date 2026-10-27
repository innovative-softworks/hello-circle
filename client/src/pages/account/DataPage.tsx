import { useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { deactivateAccount, exportMyData } from "../../api";
import { PrivacyRequestRow } from "../../components/PrivacyRequestRow";
import { useToast } from "../../components/Toast";
import { Button, ConfirmDialog } from "../../components/ui";
import { AccountSection, SettingRow, SettingRows } from "./accountUi";

/** "Your data" + "Deactivate" — the lower half of Sign-in & data (sidebar merge 2026-10-24). */
export function DataSections() {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const download = async () => {
    setExporting(true);
    try {
      await exportMyData();
      toast.success("Your data file is downloading");
    } catch {
      toast.error("Your data couldn't be prepared. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const deactivate = async () => {
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateAccount();
      window.location.href = "/";
    } catch {
      setDeactivateError("Your account wasn't deactivated. Try again, or contact support.");
      setDeactivating(false);
    }
  };

  return (
    <>
      <AccountSection title="Your data" description={<>How we use your data is set out in our <Link to="/privacy" style={{ color: "inherit", fontWeight: 700 }}>privacy policy</Link>.</>}>
        <SettingRows>
          <SettingRow
            stack
            label="Download my data"
            description="Your profile, household, saved items, notifications and Safety Centre history, as a JSON file."
            control={
              <Button variant="ghost" onClick={download} disabled={exporting} aria-busy={exporting}>
                <Download size={16} aria-hidden="true" /> {exporting ? "Preparing…" : "Download"}
              </Button>
            }
          />
          <PrivacyRequestRow />
        </SettingRows>
      </AccountSection>

      <AccountSection title="Deactivate your account">
        <SettingRows>
          <SettingRow
            stack
            label="Deactivate"
            description="You'll be signed out and hidden from familiar-faces counts and Circle invites. Nothing is deleted: sign in again with your email and everything is as you left it. To have your data deleted, use “Ask us about your data” above."
            control={<Button variant="danger" onClick={() => setConfirmOpen(true)}>Deactivate account</Button>}
          />
        </SettingRows>
        {deactivateError && <p className="acct-field-error" role="alert">{deactivateError}</p>}
      </AccountSection>

      <ConfirmDialog
        open={confirmOpen}
        title="Deactivate your account?"
        message="You'll be signed out, and hidden from familiar-faces counts and Circle invites. Nothing is deleted. Signing back in with this email reactivates your account exactly as it was."
        confirmLabel={deactivating ? "Deactivating…" : "Deactivate account"}
        tone="danger"
        busy={deactivating}
        onConfirm={deactivate}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
