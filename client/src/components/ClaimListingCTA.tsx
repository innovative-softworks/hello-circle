import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { submitClaim } from "../api";
import { useAuth } from "../AuthContext";
import { colors, radius } from "../theme";
import { Button } from "./ui";

/** Shown on a listing's detail page only when it has no owning vendor yet
 * (vendor_id IS NULL — true of every seeded centre/club today). Lets any
 * already-approved vendor request ownership, regardless of their own
 * signup-time vendorType — a vendor can manage both a centre and a club;
 * an admin approves/rejects it (see AdminDashboard's Claims tab). */
export function ClaimListingCTA({
  listingType,
  listingId,
  claimed,
}: {
  listingType: "centre" | "club";
  listingId: string;
  claimed: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (claimed || user?.role === "admin") return null;

  const label = listingType === "centre" ? "community centre" : "sports club";

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await submitClaim(listingType, listingId, message.trim() || undefined);
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't submit your claim");
    } finally {
      setSubmitting(false);
    }
  };

  const wrapStyle: React.CSSProperties = {
    background: "#fff",
    border: `1px dashed ${colors.borderStrong}`,
    borderRadius: radius.card,
    padding: "20px 22px",
  };
  const titleStyle: React.CSSProperties = { fontWeight: 700, fontSize: 15, marginBottom: 4 };
  const bodyStyle: React.CSSProperties = { margin: "0 0 12px", color: colors.mutedLight, fontSize: 14.5 };

  if (submitted) {
    return (
      <div style={wrapStyle}>
        <div style={titleStyle}>Claim submitted</div>
        <p style={{ ...bodyStyle, marginBottom: 0 }}>We'll review your request before giving you management access to this listing.</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={wrapStyle}>
        <div style={titleStyle}>Manage this {label}?</div>
        <p style={bodyStyle}>If you run this organisation, log in or sign up to claim this listing.</p>
        <div style={{ display: "flex", gap: 16 }}>
          <button
            onClick={() => navigate("/login")}
            style={{ background: "none", border: "none", color: colors.greenText, fontWeight: 700, fontSize: 14.5, cursor: "pointer", padding: 0 }}
          >
            Log in
          </button>
          <button
            onClick={() => navigate("/vendor/signup")}
            style={{ background: "none", border: "none", color: colors.greenText, fontWeight: 700, fontSize: 14.5, cursor: "pointer", padding: 0 }}
          >
            Sign up as a vendor
          </button>
        </div>
      </div>
    );
  }

  if (user.status !== "approved") {
    return (
      <div style={wrapStyle}>
        <div style={titleStyle}>Manage this {label}?</div>
        <p style={{ ...bodyStyle, marginBottom: 0 }}>
          Your vendor account is still awaiting approval — you'll be able to claim listings once it's approved.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <div style={wrapStyle}>
        <div style={titleStyle}>Manage this {label}?</div>
        <p style={bodyStyle}>If you own or manage this {label}, claim this listing to update its information and manage your Hello Circle profile.</p>
        <Button onClick={() => setOpen(true)}>Claim this listing</Button>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={{ ...titleStyle, marginBottom: 8 }}>Claim this listing</div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Optional — tell us about your role at this organisation"
        rows={2}
        style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: 10, fontSize: 14, fontFamily: "inherit", marginBottom: 10, resize: "vertical", boxSizing: "border-box" }}
      />
      {error && <div style={{ color: colors.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <Button onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Submitting…" : "Submit claim"}
      </Button>
    </div>
  );
}
