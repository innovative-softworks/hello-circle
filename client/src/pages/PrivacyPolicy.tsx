import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon } from "../components/icons";
import { colors, fonts } from "../theme";

const LAST_UPDATED = "11 August 2026";

const sectionStyle: React.CSSProperties = { margin: "0 0 28px" };
const h2Style: React.CSSProperties = { fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 10px", letterSpacing: "-.01em" };
const pStyle: React.CSSProperties = { color: "#3B423C", fontSize: 15, lineHeight: 1.65, margin: "0 0 10px" };
const liStyle: React.CSSProperties = { color: "#3B423C", fontSize: 15, lineHeight: 1.65, margin: "0 0 6px" };
const placeholder: React.CSSProperties = { background: colors.orangeBg, color: colors.orangeDark, padding: "1px 6px", borderRadius: 5, fontWeight: 600 };

export function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 760, margin: "0 auto", padding: "36px 24px 90px" }}>
        <button
          onClick={() => navigate(-1)}
          style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", color: colors.muted, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 20 }}
        >
          <ChevronLeftIcon size={14} style={{ marginRight: 4 }} /> Back
        </button>

        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(26px, 5vw, 34px)", margin: "0 0 6px", letterSpacing: "-.02em" }}>
          Privacy Policy
        </h1>
        <p style={{ color: colors.faint, fontSize: 13, margin: "0 0 30px" }}>Last updated {LAST_UPDATED}</p>

        <div style={{ background: "#FBF0E9", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", marginBottom: 30, fontSize: 13.5, color: "#3B423C", lineHeight: 1.6 }}>
          Sections marked <span style={placeholder}>like this</span> are placeholders — fill in your real company/contact
          details (and have this reviewed by a solicitor) before this goes live for real users.
        </div>

        <div style={sectionStyle}>
          <h2 style={h2Style}>1. Who we are</h2>
          <p style={pStyle}>
            This service ("Hello Circle", "we", "us") is operated by <span style={placeholder}>[Company Legal Name]</span>,
            registered at <span style={placeholder}>[Registered Address, Ireland]</span>. For any question about this
            policy or your personal data, contact <span style={placeholder}>[privacy@yourdomain.ie]</span>.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={h2Style}>2. What we collect</h2>
          <p style={pStyle}>What we collect depends on how you use the site:</p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
            <li style={liStyle}><strong>Browsing:</strong> a random identifier stored in your browser (not a cookie) so "My Life" works without an account — see our <a href="/cookies" style={{ color: colors.greenText }}>Cookie Policy</a>.</li>
            <li style={liStyle}><strong>Hall bookings:</strong> your name, email, phone number, event details and any notes you provide.</li>
            <li style={liStyle}><strong>Club registrations:</strong> a child's name and date of birth, a parent/guardian's name, email, phone and address, an emergency contact, and any medical information you choose to share so the club can look after your child safely.</li>
            <li style={liStyle}><strong>Vendor accounts:</strong> business name, address, contact details and a description, if you list a venue or club with us.</li>
            <li style={liStyle}><strong>Payments:</strong> we never see or store your card details. Payments are handled entirely by Stripe on their own secure checkout page — see <a href="https://stripe.com/ie/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.greenText }}>Stripe's privacy policy</a>.</li>
          </ul>
        </div>

        <div style={sectionStyle}>
          <h2 style={h2Style}>3. Children's data</h2>
          <p style={pStyle}>
            Club registrations involve a child's personal data (name, date of birth, and any medical information relevant
            to their participation). This information is provided by a parent or guardian, on the child's behalf, and is
            shared only with the specific club being registered with — never used for marketing, and never sold.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={h2Style}>4. Why we process your data</h2>
          <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
            <li style={liStyle}><strong>To perform a contract with you</strong> — taking a booking or registration means we need your details to confirm it, take payment, and let the venue/club contact you.</li>
            <li style={liStyle}><strong>Legitimate interest</strong> — keeping the platform secure, preventing fraud, and improving the service.</li>
            <li style={liStyle}><strong>Legal obligation</strong> — such as retaining payment records for tax purposes.</li>
          </ul>
        </div>

        <div style={sectionStyle}>
          <h2 style={h2Style}>5. Who we share it with</h2>
          <p style={pStyle}>
            The vendor (venue or club) you book with, so they can fulfil your booking. Our payment processor, Stripe, to
            take payment. Our email provider, to send booking confirmations. We do not sell personal data, and we do not
            use it for advertising.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={h2Style}>6. How long we keep it</h2>
          <p style={pStyle}>
            Booking and registration records are kept for as long as needed to resolve any dispute and to meet our
            accounting/tax obligations (typically <span style={placeholder}>[6 years]</span> under Irish tax law), then
            deleted. You can ask us to erase your data sooner — see your rights below.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={h2Style}>7. Your rights</h2>
          <p style={pStyle}>Under the GDPR, you have the right to:</p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
            <li style={liStyle}>Access the personal data we hold about you</li>
            <li style={liStyle}>Have inaccurate data corrected</li>
            <li style={liStyle}>Ask us to erase your data ("right to be forgotten")</li>
            <li style={liStyle}>Object to or restrict how we process your data</li>
            <li style={liStyle}>Receive your data in a portable format</li>
          </ul>
          <p style={pStyle}>
            To exercise any of these, contact <span style={placeholder}>[privacy@yourdomain.ie]</span>. If you're not
            satisfied with our response, you can complain to the Irish Data Protection Commission at{" "}
            <a href="https://www.dataprotection.ie" target="_blank" rel="noopener noreferrer" style={{ color: colors.greenText }}>
              dataprotection.ie
            </a>.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={h2Style}>8. Cookies & local storage</h2>
          <p style={pStyle}>
            See our <a href="/cookies" style={{ color: colors.greenText }}>Cookie Policy</a> for the full list of what we
            store in your browser and why.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={h2Style}>9. Changes to this policy</h2>
          <p style={pStyle}>
            If this policy changes, we'll update the date at the top of this page. Continued use of the site after a
            change means you accept the update.
          </p>
        </div>
      </section>
    </div>
  );
}
