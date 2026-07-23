import { useNavigate } from "react-router-dom";
import { ArrowRightIcon, BallIcon, BookmarkIcon, BookOpenIcon, BuildingIcon, DoctorIcon, HeartIcon, SchoolIcon, UsersIcon } from "../components/icons";
import { SettlingIllustration } from "../components/illustrations";
import { colors, fonts, maxWidth } from "../theme";

export function Checklist() {
  const navigate = useNavigate();

  const steps = [
    {
      n: 1,
      icon: <DoctorIcon size={26} />,
      title: "Register with a GP",
      desc: "Find a local doctor and sign up the whole family. Bring ID and proof of address.",
      bg: colors.greenBg,
      fg: colors.greenText,
    },
    {
      n: 2,
      icon: <SchoolIcon size={26} />,
      title: "Enrol your child in school",
      desc: "Contact nearby schools directly — places are offered locally, so apply early.",
      bg: colors.greenBg,
      fg: colors.greenText,
    },
    {
      n: 3,
      icon: <BookOpenIcon size={26} />,
      title: "Join the local library",
      desc: "Free membership gives you books, Wi-Fi, events and a first foothold in the community.",
      bg: colors.greenBg,
      fg: colors.greenText,
    },
    {
      n: 4,
      icon: <BallIcon size={26} />,
      title: "Register for sports clubs",
      desc: "Great way for kids to make friends fast. Many clubs offer a free trial session.",
      bg: colors.orangeBg,
      fg: colors.orangeDark,
      action: "Find clubs",
      onClick: () => navigate("/browse/clubs"),
    },
    {
      n: 5,
      icon: <BuildingIcon size={26} />,
      title: "Book community facilities",
      desc: "A hall for a birthday, naming ceremony or family get-together to celebrate settling in.",
      bg: colors.greenBg,
      fg: colors.greenText,
      action: "Find a hall",
      onClick: () => navigate("/browse/centres"),
    },
    {
      n: 6,
      icon: <UsersIcon size={26} />,
      title: "Join local parent & community groups",
      desc: "Facebook community groups and your Local Sports Partnership are full of friendly locals.",
      bg: colors.panel,
      fg: colors.muted,
    },
  ];

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "44px 24px 8px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 40, alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: 12, letterSpacing: ".1em", color: colors.green, marginBottom: 12, borderBottom: `2px solid ${colors.green}`, display: "inline-block", paddingBottom: 4 }}>
              NEW TO IRELAND
            </div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 40, margin: "0 0 10px", letterSpacing: "-.025em", lineHeight: 1.05 }}>
              Settling into your <span style={{ color: colors.green }}>new community</span>
            </h1>
            <p style={{ fontSize: 17, color: colors.muted, lineHeight: 1.55, margin: 0 }}>
              The usual order families follow when they arrive. Tick things off as you go — the last two are exactly
              what Hello Circle is here for.
            </p>
          </div>
          <div className="hide-mobile" style={{ height: 300 }}>
            <SettlingIllustration />
          </div>
        </div>
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "24px 24px 80px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 40, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {steps.map((s) => (
              <div
                key={s.n}
                className="card-surface card-hover stack-mobile"
                style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 22px", display: "flex", gap: 16, alignItems: "center" }}
              >
                <div style={{ display: "flex", gap: 16, alignItems: "center", flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: s.bg,
                      color: s.fg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: fonts.display,
                      fontWeight: 700,
                      fontSize: 14,
                      flex: "none",
                    }}
                  >
                    {s.n}
                  </div>
                  <div
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: "50%",
                      background: s.bg,
                      color: s.fg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                    }}
                  >
                    {s.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 3 }}>{s.title}</div>
                    <div style={{ color: colors.mutedLight, fontSize: 15, lineHeight: 1.5 }}>{s.desc}</div>
                  </div>
                </div>
                {s.action && (
                  <button
                    onClick={s.onClick}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: colors.greenBg, color: colors.greenText, border: "none", borderRadius: 11, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }}
                  >
                    {s.action} <ArrowRightIcon size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="sticky-aside" style={{ position: "sticky", top: 90, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ position: "relative", background: colors.greenBg, borderRadius: 18, padding: 24, overflow: "hidden" }}>
              <div style={{ position: "absolute", left: -18, bottom: -22, width: 90, height: 60, borderRadius: "50%", background: "rgba(30,122,76,.16)" }} />
              <div style={{ position: "absolute", left: 40, bottom: -30, width: 70, height: 50, borderRadius: "50%", background: "rgba(30,122,76,.12)" }} />

              <div style={{ position: "relative" }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: colors.green, marginBottom: 14 }}>
                  <HeartIcon filled size={20} />
                </div>
                <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, color: colors.greenText, margin: "0 0 8px", letterSpacing: "-.01em" }}>
                  We're here to help
                </h3>
                <p style={{ color: colors.muted, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                  Hello Circle connects you with local communities, facilities and people — so you can feel at home, faster.
                </p>
              </div>
            </div>

            <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 8 }}>
              {[
                { label: "Browse community centres", icon: <BuildingIcon size={17} />, to: "/browse/centres" },
                { label: "Browse sports clubs", icon: <BallIcon size={17} />, to: "/browse/clubs" },
                { label: "My bookings", icon: <BookmarkIcon size={17} />, to: "/bookings" },
              ].map((link) => (
                <button
                  key={link.to}
                  onClick={() => navigate(link.to)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "none",
                    border: "none",
                    borderRadius: 12,
                    padding: "12px 12px",
                    fontSize: 14,
                    fontWeight: 600,
                    color: colors.text,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  className="tab-btn"
                >
                  <span style={{ display: "flex", color: colors.mutedLight, flex: "none" }}>{link.icon}</span>
                  <span style={{ flex: 1 }}>{link.label}</span>
                  <ArrowRightIcon size={13} style={{ color: colors.faint }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
