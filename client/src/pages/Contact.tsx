import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BuildingIcon, ChatIcon, ClipboardIcon, EyeOffIcon, MailIcon, PhoneIcon, ShieldIcon } from "../components/icons";
import { DetailRow, Eyebrow } from "../components/InfoPage";
import { PageTitle } from "../components/PageTitle";
import { legalIdentityConfirmed, useCompanyDetails } from "../companyDetails";
import { colors, fonts, maxWidth, radius } from "../theme";

// Contact (sitemap audit P1-02, MS-02) — replaces the footer's bare mailto.
// One card per reason for getting in touch, each pointing at the inbox or
// page that actually handles it. The company's legal/postal details below come
// from useCompanyDetails() and appear only once a published, legally
// signed-off policy carries them — never from unverified defaults.
// No promised response times: nothing in the product backs one yet.

const linkStyle = { color: colors.greenText, fontWeight: 600 } as const;

function ContactCard({ icon, title, children, actions }: { icon: ReactNode; title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <section
      className="card-surface"
      style={{ display: "flex", flexDirection: "column", gap: 8, padding: "20px 20px 18px", border: `1px solid ${colors.border}`, borderRadius: radius.swiss.card }}
    >
      <span style={{ color: colors.greenText }} aria-hidden="true">
        {icon}
      </span>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 17, margin: 0 }}>{title}</h2>
      <div style={{ color: colors.muted, fontSize: 14, lineHeight: 1.5, flex: 1 }}>{children}</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, marginTop: 4, fontSize: 14 }}>{actions}</div>
    </section>
  );
}

function MailLink({ email }: { email: string }) {
  return (
    <a href={`mailto:${email}`} style={{ ...linkStyle, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 0", overflowWrap: "anywhere" }}>
      <MailIcon size={14} /> {email}
    </a>
  );
}

function PageLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} style={{ ...linkStyle, padding: "4px 0" }}>
      {children}
    </Link>
  );
}

export function Contact() {
  const company = useCompanyDetails();
  const phoneHref = company.phone ? `tel:${company.phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "48px 24px 8px" }}>
        <Eyebrow>Contact</Eyebrow>
        <PageTitle>Contact us</PageTitle>
        <p style={{ color: colors.textSoft, fontSize: 17, lineHeight: 1.55, maxWidth: 640, margin: "12px 0 0" }}>
          Choose what you need help with, and it'll reach the right people.
        </p>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(340px, 100%), 1fr))", gap: 14 }}>
          <ContactCard icon={<ChatIcon size={20} />} title="Help with HelloCircle" actions={<><MailLink email={company.supportEmail} /><PageLink to="/help-guide">Read the help guide</PageLink></>}>
            Bookings, your account, signing in, or something not working as it should.
          </ContactCard>

          <ContactCard icon={<BuildingIcon size={20} />} title="Venues, clubs and partners" actions={<><MailLink email={company.partnersEmail} /><PageLink to="/for-venues">List your venue</PageLink></>}>
            You run a community centre, sports club or organisation and want to list it, or you already do and need a hand.
          </ContactCard>

          <ContactCard icon={<ClipboardIcon size={20} />} title="Complaints and appeals" actions={<PageLink to="/complaints">Make a complaint or appeal</PageLink>}>
            A problem with a listing, a host or a booking, or a decision we made that you'd like us to look at again.
          </ContactCard>

          <ContactCard
            icon={<EyeOffIcon size={20} />}
            title="Privacy and your data"
            actions={
              <>
                {company.privacyEmail && <MailLink email={company.privacyEmail} />}
                <PageLink to="/privacy">Privacy policy</PageLink>
              </>
            }
          >
            You can download a copy of your data yourself from{" "}
            <Link to="/profile?tab=account" style={linkStyle}>
              Profile
            </Link>
            .{!company.privacyEmail && " A dedicated privacy contact will be listed here once it's confirmed."}
          </ContactCard>

          <ContactCard icon={<ShieldIcon size={20} />} title="Safety" actions={<PageLink to="/profile?tab=privacy">Safety Centre</PageLink>}>
            If someone is in danger right now, call <strong style={{ color: colors.text }}>112</strong> or <strong style={{ color: colors.text }}>999</strong>. To report a person or a
            message, use the report option next to it, or the Safety Centre.
          </ContactCard>
        </div>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "28px 24px 72px" }} aria-labelledby="contact-company">
        <div style={{ maxWidth: 640 }}>
          <h2 id="contact-company" style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px, 2.4vw, 26px)", letterSpacing: 0, margin: "0 0 6px" }}>
            The company behind HelloCircle
          </h2>
          <p style={{ color: colors.textSoft, fontSize: 15, lineHeight: 1.55, margin: "0 0 10px" }}>
            HelloCircle is a product of {company.brandName}, the brand of {company.legalName}. For anything about HelloCircle itself, the
            options above are quickest. <Link to="/about" style={linkStyle}>About us</Link>
          </p>
          {!legalIdentityConfirmed(company) && (
            <p style={{ color: colors.mutedLight, fontSize: 14, lineHeight: 1.5, margin: "0 0 4px" }}>
              Our registered office and company registration details are being confirmed and will be listed here soon.
            </p>
          )}
          <dl style={{ margin: 0 }}>
            <DetailRow label="Company">{company.legalName}</DetailRow>
            {company.registeredAddress && <DetailRow label="Registered address">{company.registeredAddress}</DetailRow>}
            {company.companyNumber && <DetailRow label="Company number">{company.companyNumber}</DetailRow>}
            {company.vatNumber && <DetailRow label="VAT number">{company.vatNumber}</DetailRow>}
            {company.phone && phoneHref && (
              <DetailRow label="Phone">
                <a href={phoneHref} style={{ ...linkStyle, display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                  <PhoneIcon size={14} /> {company.phone}
                </a>
              </DetailRow>
            )}
            {company.legalEmail && (
              <DetailRow label="Legal enquiries">
                <a href={`mailto:${company.legalEmail}`} style={{ ...linkStyle, display: "inline-block", padding: "3px 0" }}>
                  {company.legalEmail}
                </a>
              </DetailRow>
            )}
          </dl>
        </div>
      </section>
    </div>
  );
}
