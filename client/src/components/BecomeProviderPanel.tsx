import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { becomeProvider, fetchManageWorkspaces, switchWorkspace } from "../api";
import { useAuth } from "../AuthContext";
import { AwardIcon } from "./icons";
import { Button, inputStyle, labelStyle } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { HostStatus } from "../types";
import type { ManageWorkspaces } from "../api/manage";

// Verified Host -> provider account (the inverse of HelloCircle Manage's
// original vendor -> resident link). Before this, host_status was badge-only:
// a Verified Host could be followed and reviewed but had no way into /vendor/*,
// because the only bridge ran the other direction. Rendered in Profile.tsx
// directly under HostApplicationPanel, and only for verified Hosts — the
// application panel itself is the path to get there.

const IRISH_COUNTIES = [
  "Antrim", "Armagh", "Carlow", "Cavan", "Clare", "Cork", "Derry", "Donegal",
  "Down", "Dublin", "Fermanagh", "Galway", "Kerry", "Kildare", "Kilkenny",
  "Laois", "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath",
  "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary", "Tyrone",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
];

const WHAT_YOU_GET = [
  "List a community centre or sports club that people can book and pay for",
  "Run multi-session Programs and ticketed Experiences, not just one-off Sessions",
  "Take payments through Stripe, with bookings and attendance in one dashboard",
];

export function BecomeProviderPanel({ hostStatus }: { hostStatus: HostStatus }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [workspaces, setWorkspaces] = useState<ManageWorkspaces | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vendorType, setVendorType] = useState<"community" | "sports">("community");
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [county, setCounty] = useState("Dublin");
  const [mobile, setMobile] = useState("");
  const [description, setDescription] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (hostStatus === "verified") fetchManageWorkspaces().then(setWorkspaces).catch(() => setWorkspaces(null));
  }, [hostStatus]);

  if (hostStatus !== "verified") return null;

  const submit = async () => {
    if (!businessName.trim() || !address.trim() || !mobile.trim() || !description.trim()) {
      setError("Business name, address, mobile number and description are all required");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await becomeProvider({ vendorType, businessName, address, county, mobile, description, password });
      setOpen(false);
      setPassword("");
      setWorkspaces(await fetchManageWorkspaces());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open your provider account");
    } finally {
      setSubmitting(false);
    }
  };

  // Mirrors Header.tsx's switchToVendor — AuthContext only fetches /auth/me at
  // app load, so the freshly minted vendor cookie has to be refreshed into it
  // or VendorDashboard bounces straight back to /login.
  const switchToVendor = async () => {
    try {
      await switchWorkspace("vendor");
      await refresh();
      navigate("/vendor");
    } catch {
      navigate("/login");
    }
  };

  const vendor = workspaces?.vendor;

  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <AwardIcon size={16} style={{ color: colors.greenText }} />
        <span style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: 700 }}>Host as a provider</span>
      </div>

      {vendor ? (
        vendor.status === "approved" ? (
          <>
            <p style={{ fontSize: 13, color: colors.greenText, fontWeight: 600, margin: "8px 0 12px" }}>
              {vendor.businessName} is live — you can switch into it any time from the account menu.
            </p>
            <Button onClick={switchToVendor}>Open provider dashboard</Button>
          </>
        ) : (
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: "8px 0 0" }}>
            {vendor.businessName} is under review — an admin checks new provider accounts before listings go live.
            Your Host account is unaffected in the meantime.
          </p>
        )
      ) : !open ? (
        <>
          <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "8px 0 12px" }}>
            You're a Verified Host, so you can open a provider account to take this further — it stays linked to
            this account, and you switch between the two without signing in twice.
          </p>
          <ul style={{ margin: "0 0 14px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            {WHAT_YOU_GET.map((g) => (
              <li key={g} style={{ fontSize: 12, color: colors.mutedLight }}>{g}</li>
            ))}
          </ul>
          <Button onClick={() => setOpen(true)}>Open a provider account</Button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "8px 0 12px" }}>
            An admin reviews this before anything goes live — the same check every provider goes through.
          </p>

          <label style={labelStyle}>What do you run?</label>
          <select value={vendorType} onChange={(e) => setVendorType(e.target.value as "community" | "sports")} style={{ ...inputStyle, marginBottom: 10 }}>
            <option value="community">A community centre</option>
            <option value="sports">A sports club</option>
          </select>

          <label style={labelStyle}>Business name</label>
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />

          <label style={labelStyle}>Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />

          <label style={labelStyle}>County</label>
          <select value={county} onChange={(e) => setCounty(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
            {IRISH_COUNTIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <label style={labelStyle}>Mobile</label>
          <input value={mobile} onChange={(e) => setMobile(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />

          <label style={labelStyle}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What you run, and what people can book"
            style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }}
          />

          <label style={labelStyle}>Password for the provider login</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <p style={{ fontSize: 11.5, color: colors.mutedLight, margin: "0 0 14px" }}>
            The provider side uses an email and password, unlike your passwordless personal account. You'll sign in
            with the same email you use here.
          </p>

          {error && <p style={{ color: colors.danger, fontSize: 13, margin: "0 0 10px" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Opening…" : "Open provider account"}
            </Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setError(null); }} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
