import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flag, Phone, ShieldCheck, UserX } from "lucide-react";
import { fetchBlockedResidents, fetchMyReports, unblockResident } from "../../api";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/Toast";
import { Avatar, Button, LoadErrorState, RowSkeleton } from "../../components/ui";
import type { BlockedResident, ReportRecord } from "../../types";
import { AccountSection, Note, StatusTag, dateLong } from "./accountUi";

// Safety Centre. Reporting happens in context (the Report option on a
// listing, Circle, profile, review or chat message — ReportContentButton);
// this page tracks those reports and blocked people. Report statuses come
// from the admin queue: 'pending' until a moderator closes it. No response
// time or outcome is promised.

const TARGET_LABEL: Record<string, string> = {
  review: "Review",
  circle: "Circle",
  chat_message: "Chat message",
  game: "Session",
  centre: "Venue",
  club: "Club",
  experience: "Experience",
  program: "Programme",
  host: "Host",
  provider: "Provider",
  circle_memory: "Circle memory",
  circle_plan: "Circle plan",
};

const GUIDANCE = [
  { t: "Meet somewhere public", d: "For a first meet-up, choose a venue or a busy park rather than someone's home." },
  { t: "Tell someone where you'll be", d: "Share the activity link with a friend or family member." },
  { t: "Keep chat on HelloCircle", d: "Until you know people, there's no need to share your number or address." },
  { t: "Trust your instincts", d: "If something doesn't feel right, leave, and tell us about it." },
];

/** Safety half of "Privacy & safety" (sidebar merge 2026-10-24). */
export function SafetySections() {
  const confirm = useConfirm();
  const toast = useToast();
  const [blocked, setBlocked] = useState<BlockedResident[] | null>(null);
  const [reports, setReports] = useState<ReportRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    Promise.all([fetchBlockedResidents(), fetchMyReports()])
      .then(([b, r]) => {
        setBlocked(b);
        setReports(r);
      })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  const unblock = async (b: BlockedResident) => {
    const ok = await confirm({
      title: `Unblock ${b.name}?`,
      message: "They'll be able to see you in shared activities and chats again, and you'll see their messages.",
      confirmLabel: "Unblock",
      tone: "neutral",
    });
    if (!ok) return;
    try {
      await unblockResident(b.id);
      setBlocked((rows) => rows && rows.filter((x) => x.id !== b.id));
      toast.success(`${b.name} unblocked`);
    } catch {
      toast.error(`${b.name} is still blocked. Try again.`);
    }
  };

  return (
    <>
      <AccountSection>
        <Note icon={<Phone size={16} aria-hidden="true" />}>
          <strong>If anyone is in danger, call 112 or 999 now.</strong> HelloCircle can't send emergency help.
        </Note>
      </AccountSection>

      <AccountSection title="Report something" description="Use Report where you see the problem: on a Session, Circle, listing, profile, review or chat message. It goes straight to our moderation team with the details attached.">
        <div className="acct-cols">
          <div className="acct-col">
            <h3>What happens next</h3>
            <p>A moderator reviews it. You can follow its status below. We may not be able to tell you exactly what action we took.</p>
          </div>
          <div className="acct-col">
            <h3>Something else?</h3>
            <p>
              For a problem with a booking, a payment or how we handled something, use the <Link to="/complaints">complaints process</Link> or email{" "}
              <a href="mailto:support@hellocircle.ie">support@hellocircle.ie</a>.
            </p>
          </div>
        </div>
      </AccountSection>

      {failed ? (
        <AccountSection>
          <LoadErrorState title="We couldn't load your reports and blocked list." onRetry={load} />
        </AccountSection>
      ) : (
        <>
          <AccountSection title="Your reports">
            {reports === null ? (
              <RowSkeleton />
            ) : reports.length === 0 ? (
              <p className="acct-row-desc" style={{ margin: 0 }}>You haven't reported anything.</p>
            ) : (
              <ul className="acct-list">
                {reports.map((r) => (
                  <li key={r.id} className="acct-item">
                    <span className="acct-thumb" aria-hidden="true"><Flag size={18} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="acct-item-title">{TARGET_LABEL[r.targetType] ?? "Content"} · {r.reason}</div>
                      <div className="acct-item-meta">
                        {r.caseRef ? `Case ${r.caseRef} · ` : ""}
                        {r.category === "safety" ? "Safety concern · " : ""}Reported {dateLong(r.createdAt)}
                        {r.decidedAt ? ` · decided ${dateLong(r.decidedAt)}` : ""}
                      </div>
                      {r.canAppeal && (
                        <div className="acct-item-meta">
                          <Link to={`/complaints?kind=appeal&subject=moderation_decision&ref=${r.id}`}>Ask us to reconsider</Link>
                        </div>
                      )}
                    </div>
                    <div className="acct-item-side">
                      <StatusTag tone={r.status === "pending" ? "warn" : "ok"}>{r.status === "pending" ? "Under review" : r.status.charAt(0).toUpperCase() + r.status.slice(1).replace(/_/g, " ")}</StatusTag>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AccountSection>

          <AccountSection title="Blocked people" description="Block someone from a Circle's or Session's chat. They can't see you in shared activities and chats, and you won't see their messages.">
            {blocked === null ? (
              <RowSkeleton />
            ) : blocked.length === 0 ? (
              <p className="acct-row-desc" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <UserX size={16} aria-hidden="true" /> You haven't blocked anyone.
              </p>
            ) : (
              <ul className="acct-list">
                {blocked.map((b) => (
                  <li key={b.id} className="acct-item">
                    <Avatar name={b.name} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }} className="acct-item-title">{b.name}</div>
                    <div className="acct-item-side">
                      <Button variant="ghost" onClick={() => unblock(b)} aria-label={`Unblock ${b.name}`}>Unblock</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AccountSection>
        </>
      )}

      <AccountSection title="Staying safe">
        <div className="acct-cols">
          {GUIDANCE.map((g) => (
            <div key={g.t} className="acct-col">
              <h3><ShieldCheck size={16} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />{g.t}</h3>
              <p>{g.d}</p>
            </div>
          ))}
        </div>
      </AccountSection>
    </>
  );
}
