import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BadgeCheck, CalendarPlus, Store, UsersRound } from "lucide-react";
import { fetchManageWorkspaces } from "../../api";
import type { ManageWorkspaces } from "../../api/manage";
import { BecomeProviderPanel } from "../../components/BecomeProviderPanel";
import { HostApplicationPanel } from "../../components/HostApplicationPanel";
import { Button, LoadErrorState, Modal, RowSkeleton } from "../../components/ui";
import { AccountPage, AccountSection, StatusTag } from "./accountUi";
import { useResidentFull } from "./useResidentFull";

// Hosting (account redesign). Facts come from the existing host journey
// (BecomeAHost.tsx FAQ, HostApplicationPanel, BecomeProviderPanel): anyone can
// host a Session or start a Circle for free with no approval step; Verified
// Host is an optional, admin-reviewed badge; only a Verified Host can open a
// linked provider account to take payments. Nothing here changes those rules.

const STEPS = [
  { t: "Pick an activity and a place", d: "A park, a court, a hall someone has listed, or your own spot. You don't need a venue or a business." },
  { t: "Post it", d: "It goes live as soon as you submit it. Set a minimum number of people if you need one to run." },
  { t: "People join", d: "You'll see who's coming and can message them before the day." },
  { t: "Run it, or cancel with notice", d: "Show up and enjoy it. If it isn't coming together, cancel early so people can make other plans." },
];

export function HostingPage() {
  const navigate = useNavigate();
  const { data, loading, failed, reload } = useResidentFull();
  const [workspaces, setWorkspaces] = useState<ManageWorkspaces | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  useEffect(() => {
    fetchManageWorkspaces().then(setWorkspaces).catch(() => setWorkspaces(null));
  }, []);

  const verified = data?.hostStatus === "verified";
  const organising = workspaces?.circlesOrganising ?? [];
  const existingHost = verified || organising.length > 0;

  return (
    <AccountPage eyebrow="Hosting" title={existingHost ? "Your hosting" : "Hosting"} lede={existingHost ? "Manage what you host, or start something new." : undefined}>
      {loading ? (
        <div style={{ marginTop: 24 }}><RowSkeleton /></div>
      ) : failed || !data ? (
        <LoadErrorState title="We couldn't load your hosting details." onRetry={reload} />
      ) : (
        <>
          {existingHost ? (
            <AccountSection
              title="Hosting dashboard"
              description="Your Sessions, Circles, attendees and messages are in one place."
              action={<Button onClick={() => navigate("/manage")}>Open hosting dashboard <ArrowRight size={16} aria-hidden="true" /></Button>}
            >
              {organising.length > 0 && (
                <ul className="acct-list">
                  {organising.map((c) => (
                    <li key={c.id} className="acct-item">
                      <Link to={`/manage/circles/${c.slug ?? c.id}`} className="acct-item-main">
                        <span className="acct-thumb" aria-hidden="true"><UsersRound size={18} /></span>
                        <span style={{ minWidth: 0 }}>
                          <span className="acct-item-title" style={{ display: "block" }}>{c.name}</span>
                          <span className="acct-item-meta" style={{ display: "block" }}>Circle you organise</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <Button variant="ghost" onClick={() => navigate("/games/host")}><CalendarPlus size={16} aria-hidden="true" /> Host a Session</Button>
                <Button variant="ghost" onClick={() => navigate("/circles/start")}><UsersRound size={16} aria-hidden="true" /> Start a Circle</Button>
              </div>
            </AccountSection>
          ) : (
            <div className="acct-hero" style={{ paddingTop: 26 }}>
              <h2>
                Bring people <em>together.</em>
              </h2>
              <p>
                Host a one-off Session, like a Saturday kickabout or a beginners' walk, or start a Circle that meets regularly. It's free, anyone can do it, and
                there's no approval step.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button size="lg" onClick={() => navigate("/games/host")}>Host a Session</Button>
                <Button variant="ghost" size="lg" onClick={() => navigate("/circles/start")}>Start a Circle</Button>
              </div>
              <p style={{ fontSize: 14, margin: "18px 0 0" }}>
                Already hosted something? <Link to="/manage" style={{ color: "inherit", fontWeight: 700 }}>Go to your hosting dashboard</Link>
              </p>
            </div>
          )}

          {!existingHost && (
            <AccountSection title="How it works">
              <ol className="acct-steps">
                {STEPS.map((s) => (
                  <li key={s.t}>
                    <strong>{s.t}</strong>
                    <span>{s.d}</span>
                  </li>
                ))}
              </ol>
            </AccountSection>
          )}

          <AccountSection title="What you can host">
            <div className="acct-cols">
              <div className="acct-col">
                <h3><CalendarPlus size={17} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />Sessions</h3>
                <p>A one-off game, walk, class or meet-up. Free to run.</p>
              </div>
              <div className="acct-col">
                <h3><UsersRound size={17} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />Circles</h3>
                <p>An ongoing group around a shared activity, organised by its own members. Free to run.</p>
              </div>
              <div className="acct-col">
                <h3><Store size={17} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />Programmes and experiences</h3>
                <p>Paid, multi-session or ticketed. Needs a provider account, which Verified Hosts can open below.</p>
              </div>
            </div>
          </AccountSection>

          <AccountSection
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <BadgeCheck size={20} aria-hidden="true" /> Verified Host
                {data.hostStatus === "verified" && <StatusTag tone="ok">Verified</StatusTag>}
                {data.hostStatus === "pending" && <StatusTag tone="warn">Under review</StatusTag>}
                {data.hostStatus === "rejected" && <StatusTag tone="muted">Not approved</StatusTag>}
              </span>
            }
            description="An optional badge, not a requirement. Our team reviews your application, and approved hosts get a badge next to their name."
          >
            {data.hostStatus === "pending" ? (
              <HostApplicationPanel bare hostStatus={data.hostStatus} hostDecision={data.hostDecision ?? null} hostBio={data.hostBio} hostPhone={data.hostPhone} onApplied={reload} />
            ) : (
              <>
                {data.hostStatus === "rejected" && (
                  <p className="acct-row-desc" style={{ margin: "0 0 12px" }}>Your last application wasn't approved. You're welcome to apply again.</p>
                )}
                {data.hostStatus === "verified" && data.hostBio && <p className="acct-section-desc" style={{ margin: "0 0 12px" }}>“{data.hostBio}”</p>}
                <Button variant={data.hostStatus === "verified" ? "ghost" : "primary"} onClick={() => setApplyOpen(true)}>
                  {data.hostStatus === "verified" ? "Edit host bio" : "Apply for Verified Host"}
                </Button>
              </>
            )}
            {/* Owner 2026-10-24: forms open in a centred popup, not inline. */}
            <Modal
              open={applyOpen}
              onClose={() => setApplyOpen(false)}
              title={data.hostStatus === "verified" ? "Edit your host bio" : "Apply for Verified Host"}
              size="wide"
            >
              <HostApplicationPanel
                bare
                hostStatus={data.hostStatus}
                hostDecision={data.hostDecision ?? null}
                hostBio={data.hostBio}
                hostPhone={data.hostPhone}
                onApplied={() => {
                  setApplyOpen(false);
                  void reload();
                }}
              />
            </Modal>
          </AccountSection>

          {verified && (
            <AccountSection title="Take payments as a provider">
              <BecomeProviderPanel bare hostStatus={data.hostStatus} />
            </AccountSection>
          )}
        </>
      )}
    </AccountPage>
  );
}
