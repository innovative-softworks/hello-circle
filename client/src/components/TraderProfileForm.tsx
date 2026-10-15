import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTraderProfile, saveTraderProfile, type TraderProfile, type TraderProfileInput } from "../api";
import { colors, fonts, radius } from "../theme";
import { Button, ManageCard as Card, inputStyle, labelStyle } from "./ui";

// Revenue & Connect Stage 4 — the seller's trader details (DSA art. 30,
// DAC7). Shared by the vendor Organisation tab and the host Earnings tab.
// The TIN is never shown in full: leave the masked value to keep it.

const EMPTY: TraderProfileInput = {
  entityType: "company",
  legalName: "",
  tradingName: "",
  address: "",
  country: "IE",
  email: "",
  phone: "",
  companyNumber: "",
  vatNumber: "",
  tin: "",
  dateOfBirth: "",
  insuranceExpiresAt: "",
  selfCertify: false,
};

const STATUS: Record<string, { label: string; tone: string }> = {
  unverified: { label: "Not yet verified", tone: colors.orangeDark },
  verified: { label: "Verified", tone: colors.greenText },
  rejected: { label: "Needs changes", tone: colors.danger },
};

export function TraderProfileForm({ scope, defaultEntity = "company" }: { scope: "vendor" | "host"; defaultEntity?: "company" | "individual" }) {
  const [form, setForm] = useState<TraderProfileInput>({ ...EMPTY, entityType: defaultEntity });
  const [saved, setSaved] = useState<TraderProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fill = (p: TraderProfile) => {
    setSaved(p);
    setForm({
      entityType: p.entityType,
      legalName: p.legalName,
      tradingName: p.tradingName ?? "",
      address: p.address,
      country: p.country,
      email: p.email,
      phone: p.phone,
      companyNumber: p.companyNumber ?? "",
      vatNumber: p.vatNumber ?? "",
      tin: p.tin ?? "",
      dateOfBirth: p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : "",
      insuranceExpiresAt: p.insuranceExpiresAt ? String(p.insuranceExpiresAt).slice(0, 10) : "",
      selfCertify: !!p.selfCertifiedAt,
    });
  };

  useEffect(() => {
    fetchTraderProfile(scope)
      .then((p) => {
        if (p) fill(p);
        setState("ready");
      })
      .catch(() => setState("forbidden"));
  }, [scope]);

  if (state === "loading") return null;
  if (state === "forbidden") return null; // staff without the finance role don't see trader details

  const set = (k: keyof TraderProfileInput) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const status = saved ? STATUS[saved.verificationStatus] ?? STATUS.unverified : null;

  return (
    <Card style={{ padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: 0 }}>Trader details</h2>
        {status && <span style={{ fontSize: 12.5, fontWeight: 700, color: status.tone }}>{status.label}</span>}
      </div>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "6px 0 14px", lineHeight: 1.5 }}>
        Required before selling paid activities. Your name, address, contact details and registration number are shown to customers on your listings; your tax number and date of birth are not. See the{" "}
        <Link to="/policies/trader-verification" style={{ color: colors.greenText }}>Trader Verification Policy</Link> and{" "}
        <Link to="/policies/dac7-seller-notice" style={{ color: colors.greenText }}>DAC7 Seller Notice</Link>.
      </p>
      {saved?.verificationNote && saved.verificationStatus === "rejected" && (
        <p role="status" style={{ background: colors.dangerBg, color: colors.danger, padding: "8px 12px", borderRadius: radius.control, fontSize: 13 }}>{saved.verificationNote}</p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        <label>
          <span style={labelStyle}>Selling as</span>
          <select value={form.entityType} onChange={set("entityType")} style={inputStyle}>
            <option value="company">A company or organisation</option>
            <option value="individual">An individual</option>
          </select>
        </label>
        <label><span style={labelStyle}>Legal name</span><input value={form.legalName} onChange={set("legalName")} style={inputStyle} autoComplete="organization" /></label>
        <label><span style={labelStyle}>Trading name (optional)</span><input value={form.tradingName ?? ""} onChange={set("tradingName")} style={inputStyle} /></label>
        <label style={{ gridColumn: "1 / -1" }}><span style={labelStyle}>Address</span><textarea rows={2} value={form.address} onChange={set("address")} style={{ ...inputStyle, resize: "vertical" }} autoComplete="street-address" /></label>
        <label>
          <span style={labelStyle}>Country</span>
          <select value={form.country} onChange={set("country")} style={inputStyle}>
            <option value="IE">Ireland</option>
            <option value="GB">United Kingdom</option>
            <option value="FR">France</option>
            <option value="DE">Germany</option>
            <option value="ES">Spain</option>
            <option value="IT">Italy</option>
            <option value="NL">Netherlands</option>
            <option value="BE">Belgium</option>
            <option value="PT">Portugal</option>
            <option value="PL">Poland</option>
          </select>
        </label>
        <label><span style={labelStyle}>Contact email</span><input type="email" value={form.email} onChange={set("email")} style={inputStyle} autoComplete="email" /></label>
        <label><span style={labelStyle}>Phone</span><input type="tel" value={form.phone} onChange={set("phone")} style={inputStyle} autoComplete="tel" /></label>
        {form.entityType === "company" ? (
          <label><span style={labelStyle}>Company registration number</span><input value={form.companyNumber ?? ""} onChange={set("companyNumber")} style={inputStyle} /></label>
        ) : (
          <label><span style={labelStyle}>Date of birth</span><input type="date" value={form.dateOfBirth ?? ""} onChange={set("dateOfBirth")} style={inputStyle} autoComplete="bday" /></label>
        )}
        <label><span style={labelStyle}>VAT number (if registered)</span><input value={form.vatNumber ?? ""} onChange={set("vatNumber")} style={inputStyle} /></label>
        <label>
          <span style={labelStyle}>Tax number (TIN / PPSN)</span>
          <input value={form.tin ?? ""} onChange={set("tin")} style={inputStyle} autoComplete="off" />
          {saved?.hasTin && <span style={{ fontSize: 11.5, color: colors.mutedLight }}>Saved — leave as is to keep it</span>}
        </label>
        <label><span style={labelStyle}>Insurance valid until (optional)</span><input type="date" value={form.insuranceExpiresAt ?? ""} onChange={set("insuranceExpiresAt")} style={inputStyle} /></label>
      </div>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, margin: "16px 0 12px" }}>
        <input type="checkbox" checked={form.selfCertify} onChange={(e) => setForm({ ...form, selfCertify: e.target.checked })} style={{ marginTop: 3 }} />
        <span>I certify that I only offer products and services that comply with applicable EU law, and that these details are accurate.</span>
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const p = await saveTraderProfile(scope, { ...form, tin: form.tin || null });
              fill(p);
              setMsg({ ok: true, text: "Saved." });
            } catch (e) {
              setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save" });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save trader details"}
        </Button>
        {msg && <span role="status" style={{ fontSize: 13, color: msg.ok ? colors.greenText : colors.danger }}>{msg.text}</span>}
      </div>
    </Card>
  );
}
