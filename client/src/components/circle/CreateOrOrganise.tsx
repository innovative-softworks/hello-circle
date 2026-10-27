import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, ChartColumn, Compass, HandHeart, Lightbulb, Link2, MapPin, Mountain, Sparkles, UserPlus, GraduationCap } from "lucide-react";
import { fetchManageWorkspaces, switchWorkspace } from "../../api";
import { useAuth } from "../../AuthContext";
import { Modal } from "../ui";
import "./circleExperience.css";

// Circles 3.1 — one "Create or organise" entry on the Circle page. Three
// different things, never mixed up: create a new listing (through its
// existing create page, with this Circle carried along), bring something
// that already exists into the Circle (link or plan), and quick actions.
// Only what this person can actually do is offered; partner listings are
// explained rather than shown as buttons that can't work.

type Item = { key: string; icon: ReactNode; label: string; sub: string; onClick?: () => void; render?: (content: ReactNode) => ReactNode; disabledNote?: string };

export function CreateOrOrganise({
  open,
  onClose,
  circle,
  isOrganiser,
  onSuggestPlan,
  onPoll,
  onLink,
  inviteRender,
}: {
  open: boolean;
  onClose: () => void;
  circle: { id: string; slug: string | null; name: string; activityLabel: string };
  isOrganiser: boolean;
  onSuggestPlan: () => void;
  onPoll: () => void;
  onLink: (kind: "all" | "place") => void;
  inviteRender: (content: ReactNode) => ReactNode;
}) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [vendor, setVendor] = useState<{ businessName: string } | null | undefined>(undefined);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchManageWorkspaces()
      .then((w) => setVendor(w.vendor && w.vendor.status === "approved" ? { businessName: w.vendor.businessName } : null))
      .catch(() => setVendor(null));
  }, [open]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  // Partner listings are created in the partner workspace, as the partner.
  const asPartner = async (to: string) => {
    setSwitchError(null);
    try {
      await switchWorkspace("vendor");
      await refresh();
      go(to);
    } catch {
      setSwitchError("Couldn't open your partner account. Try again, or switch from the account menu.");
    }
  };
  const activityTo = `/games/host?activity=${encodeURIComponent(circle.activityLabel)}&${isOrganiser ? "circleId" : "shareToCircleId"}=${circle.id}`;

  const create: Item[] = [
    { key: "activity", icon: <CalendarPlus size={18} />, label: "Activity or game", sub: isOrganiser ? "The Circle's own activity, shown to its members." : "You host it; an organiser approves it for the Circle.", onClick: () => go(activityTo) },
    { key: "event", icon: <Sparkles size={18} />, label: "Event", sub: "On HelloCircle an event is an activity with a date and place.", onClick: () => go(activityTo) },
  ];
  const partnerCan = !!vendor && isOrganiser;
  if (partnerCan) {
    const q = `circleId=${circle.id}`;
    create.push(
      { key: "adventure", icon: <Mountain size={18} />, label: "Adventure", sub: `As ${vendor!.businessName}. HelloCircle reviews it before it goes live.`, onClick: () => asPartner(`/vendor/experiences/new?${q}&kind=adventure`) },
      { key: "experience", icon: <Compass size={18} />, label: "Experience", sub: `As ${vendor!.businessName}. HelloCircle reviews it before it goes live.`, onClick: () => asPartner(`/vendor/experiences/new?${q}&kind=experience`) },
      { key: "volunteer", icon: <HandHeart size={18} />, label: "Volunteering opportunity", sub: `As ${vendor!.businessName}. HelloCircle reviews it before it goes live.`, onClick: () => asPartner(`/vendor/experiences/new?${q}&kind=volunteer`) },
      { key: "programme", icon: <GraduationCap size={18} />, label: "Programme", sub: `As ${vendor!.businessName}, at one of your venues.`, onClick: () => asPartner(`/vendor/programs/new?${q}`) }
    );
  }
  create.push(
    { key: "plan", icon: <Lightbulb size={18} />, label: "Circle plan", sub: "An idea members can say they're in to.", onClick: () => (onClose(), onSuggestPlan()) },
    { key: "poll", icon: <ChartColumn size={18} />, label: "Poll", sub: "Ask members to pick a day or time.", onClick: () => (onClose(), onPoll()) }
  );

  const bring: Item[] = [
    { key: "link", icon: <Link2 size={18} />, label: "Link something that's already on HelloCircle", sub: "An activity, adventure, experience, volunteering or programme. Link it, or plan to go together.", onClick: () => (onClose(), onLink("all")) },
    { key: "place", icon: <MapPin size={18} />, label: "Suggest a place", sub: "A community centre or club to meet at. It doesn't book a room.", onClick: () => (onClose(), onLink("place")) },
  ];
  const quick: Item[] = [
    { key: "invite", icon: <UserPlus size={18} />, label: "Invite members", sub: "Share the Circle with people you know.", render: inviteRender },
    { key: "suggest", icon: <Lightbulb size={18} />, label: "Suggest a plan", sub: "Say what you'd like to do.", onClick: () => (onClose(), onSuggestPlan()) },
    { key: "availability", icon: <ChartColumn size={18} />, label: "Start an availability poll", sub: "Find a day that works.", onClick: () => (onClose(), onPoll()) },
  ];

  const list = (items: Item[]) => (
    <ul className="coo-list">
      {items.map((i) => {
        const content = (
          <>
            <span className="coo-icon" aria-hidden="true">
              {i.icon}
            </span>
            <span className="coo-text">
              <strong>{i.label}</strong>
              <span>{i.sub}</span>
            </span>
          </>
        );
        return (
          <li key={i.key}>
            {i.render ? (
              i.render(content)
            ) : (
              <button type="button" className="coo-item" onClick={i.onClick}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <Modal open={open} onClose={onClose} title="Create or organise" subtitle={`For ${circle.name}`} size="wide">
      <div className="coo">
        <section aria-labelledby="coo-create">
          <h3 id="coo-create">Create something new</h3>
          {list(create)}
          {vendor === null && (
            <p className="coo-note">Adventures, experiences, volunteering and programmes are listed by partners on HelloCircle. If one's already listed, link it below.</p>
          )}
          {vendor && !isOrganiser && (
            <p className="coo-note">Your organisation ({vendor.businessName}) can list adventures, experiences and programmes for Circles its people organise. Here, create it as usual, then link it to this Circle once it's live.</p>
          )}
          {switchError && (
            <p role="alert" className="cp-error">
              {switchError}
            </p>
          )}
        </section>
        <section aria-labelledby="coo-bring">
          <h3 id="coo-bring">Bring something into this Circle</h3>
          {list(bring)}
        </section>
        <section aria-labelledby="coo-quick">
          <h3 id="coo-quick">Quick actions</h3>
          {list(quick)}
        </section>
      </div>
    </Modal>
  );
}
