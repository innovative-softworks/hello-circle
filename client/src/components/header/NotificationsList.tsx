import { Link } from "react-router-dom";
import { notificationHref } from "../../notificationLink";
import type { ResidentNotification } from "../../types";
import { colors } from "../../theme";
import { countLabel, dividerStyle, inlineCountStyle, menuLabelStyle } from "./headerStyles";

export const NOTIFICATIONS_INBOX = "/profile?tab=inbox";

// Resident notifications for the bell (desktop panel and mobile sheet).
// Header audit P1-4: each one now opens its own destination (the same map
// the inbox and native push use), falling back to the inbox; "See all" links
// to the inbox itself. A linked business account gets its own clearly named
// row rather than being mixed into these.
export function NotificationsList({
  notifs,
  markRead,
  onNavigate,
  business,
}: {
  notifs: ResidentNotification[];
  markRead: (id: number) => void;
  onNavigate: () => void;
  business?: { label: string; to: string; count: number } | null;
}) {
  return (
    <div>
      <div style={menuLabelStyle}>Notifications</div>
      {business && (
        <>
          <Link className="hc-menu-row" to={business.to} onClick={onNavigate}>
            {business.label}
            {business.count > 0 && <span style={inlineCountStyle}>{countLabel(business.count)}</span>}
          </Link>
          <div style={dividerStyle} />
        </>
      )}
      {notifs.length === 0 ? (
        <div style={{ padding: "14px 12px", fontSize: 13.5, color: colors.mutedLight }}>You're all caught up.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {notifs.slice(0, 8).map((n) => (
            <li key={n.id} style={{ marginBottom: 2 }}>
              <Link
                className={`hc-menu-row${n.read ? "" : " hc-menu-row--unread"}`}
                style={{ display: "block" }}
                to={notificationHref(n) ?? NOTIFICATIONS_INBOX}
                onClick={() => {
                  if (!n.read) markRead(n.id);
                  onNavigate();
                }}
              >
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>
                  {!n.read && <span className="visually-hidden-input">Unread: </span>}
                  {n.title}
                </span>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 400, color: colors.mutedLight, marginTop: 2 }}>{n.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div style={dividerStyle} />
      <Link className="hc-menu-row" to={NOTIFICATIONS_INBOX} onClick={onNavigate} style={{ fontSize: 13.5 }}>
        See all notifications
      </Link>
    </div>
  );
}
