import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRightIcon, BuildingIcon, GridIcon, PlusIcon, RepeatIcon, TreeIconSmall } from "../components/icons";
import { DetailRow, Eyebrow } from "../components/InfoPage";
import { PageTitle } from "../components/PageTitle";
import { legalIdentityConfirmed, useCompanyDetails } from "../companyDetails";
import { colors, fonts, maxWidth, radius } from "../theme";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { CtaBand } from "../components/CtaBand";

// About HelloCircle (sitemap audit P1-02, MS-01) — what the product is and
// who runs it. The operator (legal company and brand) is owner-confirmed; the
// other legal facts come from useCompanyDetails() — Policy CMS values, and
// only once a published, legally signed-off policy carries them; until then
// the page says they're being confirmed. Nothing here is
// a marketing claim we can't stand behind (no user counts, no launch dates).

const linkStyle = { color: colors.greenText, fontWeight: 600 } as const;

interface Way {
  icon: ReactNode;
  title: string;
  text: string;
  to: string;
  cta: string;
}

const WAYS: Way[] = [
  { icon: <RepeatIcon size={20} />, title: "Join an activity", text: "Pickup games, classes and meetups near you, posted by people who run them.", to: "/games", cta: "Find activities" },
  { icon: <GridIcon size={20} />, title: "Find your Circle", text: "Regular groups built around something you love doing — a weekly run, a book club, Sunday football.", to: "/circles", cta: "Browse Circles" },
  { icon: <TreeIconSmall size={20} />, title: "Try something new", text: "Programmes, experiences and adventures — from multi-week courses to a one-off guided hike.", to: "/programs", cta: "See programmes" },
  { icon: <PlusIcon size={20} />, title: "Host something", text: "Post an activity or start a Circle for free. No venue or business needed.", to: "/become-a-host", cta: "Become a host" },
];

const VENUE_WAY: Way = { icon: <BuildingIcon size={20} />, title: "Book a place", text: "Community centres with halls and rooms to hire, and sports clubs to join.", to: "/browse/centres", cta: "Find a place" };

export function About() {
  const company = useCompanyDetails();
  const ways = VENUE_PAGES_PUBLIC ? [...WAYS, VENUE_WAY] : WAYS;

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "48px 24px 24px" }}>
        <Eyebrow>About</Eyebrow>
        <PageTitle style={{ maxWidth: 760 }}>Local activity, easier to find and easier to join.</PageTitle>
        <p style={{ color: colors.textSoft, fontSize: 17, lineHeight: 1.55, maxWidth: 680, margin: "12px 0 0" }}>
          HelloCircle brings together what's happening in your area — activities you can just turn up to, groups that meet every week, courses and
          experiences, and the people who organise them — so taking part is as simple as finding it.
        </p>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "32px 24px" }} aria-labelledby="about-what">
        <h2 id="about-what" style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px, 2.4vw, 26px)", letterSpacing: 0, margin: "0 0 16px" }}>
          What you can do on HelloCircle
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}>
          {ways.map((w) => (
            <Link
              key={w.title}
              to={w.to}
              className="card-surface card-hover"
              style={{ display: "flex", flexDirection: "column", gap: 8, padding: "20px 20px 18px", border: `1px solid ${colors.border}`, borderRadius: radius.swiss.card, color: colors.text, textDecoration: "none" }}
            >
              <span style={{ color: colors.greenText }}>{w.icon}</span>
              <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 17 }}>{w.title}</span>
              <span style={{ color: colors.muted, fontSize: 14, lineHeight: 1.5, flex: 1 }}>{w.text}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13.5, marginTop: 4 }}>
                {w.cta} <ArrowRightIcon size={13} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "32px 24px" }} aria-labelledby="about-who">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 40, alignItems: "start" }}>
          <div>
            <Eyebrow>Who we are</Eyebrow>
            <h2 id="about-who" style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px, 2.4vw, 26px)", letterSpacing: 0, margin: "0 0 12px" }}>
              Built and run in Ireland by {company.brandName}
            </h2>
            <p style={{ color: colors.textSoft, fontSize: 15.5, lineHeight: 1.6, margin: "0 0 12px" }}>
              HelloCircle is a product of {company.brandName}, the brand of {company.legalName}, an Irish technology company that operates
              HelloCircle.
            </p>
            <p style={{ color: colors.textSoft, fontSize: 15.5, lineHeight: 1.6, margin: 0 }}>
              Questions, feedback or a partnership in mind? <Link to="/contact" style={linkStyle}>Get in touch</Link>. Run a community centre or sports club?{" "}
              <Link to="/for-venues" style={linkStyle}>List your venue</Link>.
            </p>
          </div>
          <div>
            <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Company details</h3>
            {!legalIdentityConfirmed(company) && (
              <p style={{ color: colors.mutedLight, fontSize: 14, lineHeight: 1.5, margin: "6px 0 4px" }}>
                Our registered office and company registration details are being confirmed and will appear here soon. In the meantime,{" "}
                <Link to="/contact" style={linkStyle}>
                  contact us
                </Link>{" "}
                with any question.
              </p>
            )}
            <dl style={{ margin: 0 }}>
              <DetailRow label="Operated by">{company.legalName}</DetailRow>
              {company.tradingName && <DetailRow label="Trading as">{company.tradingName}</DetailRow>}
              {company.registeredAddress && <DetailRow label="Registered address">{company.registeredAddress}</DetailRow>}
              {company.companyNumber && <DetailRow label="Company number">{company.companyNumber}</DetailRow>}
              {company.vatNumber && <DetailRow label="VAT number">{company.vatNumber}</DetailRow>}
              <DetailRow label={`${company.brandName} website`}>
                <a
                  href={company.brandWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${company.brandWebsite.replace(/^https?:\/\//, "")} (opens in a new tab)`}
                  style={{ ...linkStyle, display: "inline-block", padding: "3px 0" }}
                >
                  {company.brandWebsite.replace(/^https?:\/\//, "")} ↗
                </a>
              </DetailRow>
            </dl>
          </div>
        </div>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "24px 24px 72px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", columnGap: 24, rowGap: 4 }}>
          <Link to="/policies" style={{ ...linkStyle, padding: "4px 0" }}>
            Terms &amp; policies
          </Link>
          <Link to="/privacy" style={{ ...linkStyle, padding: "4px 0" }}>
            Privacy
          </Link>
          <Link to="/complaints" style={{ ...linkStyle, padding: "4px 0" }}>
            Complaints &amp; appeals
          </Link>
        </div>
      </section>      <CtaBand
        id="about-cta-title"
        lines={["Let's make", "things", "happen."]}
        text="A community of people, places and possibilities across Ireland."
        action={{ label: "Find something to do", to: "/explore" }}
      />

    </div>
  );
}
