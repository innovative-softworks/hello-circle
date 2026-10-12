import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminPendingListings,
  fetchChatInbox,
  fetchManageWorkspaces,
  fetchMyGames,
  fetchResidentNotificationsPage,
  fetchVendorListings,
  fetchVendorNotifications,
  markResidentNotificationRead,
} from "../../api";
import type { ManageWorkspaces } from "../../api/manage";
import type { Resident, ResidentNotification } from "../../types";

interface SessionUser {
  role: "vendor" | "admin";
  status: string;
  residentId?: string | null;
}

/** Re-run `load` when the window regains focus — instead of on every route
 * change (header/navigation audit P2-5). */
function useOnFocus(load: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, enabled]);
}

// Everything the header shows that comes from the server. All counts are the
// server's own figures — nothing is estimated client-side.
export function useHeaderData(user: SessionUser | null, resident: Resident | null) {
  const hostOnly = !resident && user?.role === "vendor";
  // The workspace switcher only applies when the vendor/admin session and the
  // resident session are the same person (see Header.tsx history: plain `!user`
  // hid the entries after switching to Personal).
  const samePerson = !user || user.residentId === resident?.id;

  // Admin: listings awaiting approval. Vendor: own listings pending/rejected.
  const [businessCount, setBusinessCount] = useState(0);
  const loadBusiness = useCallback(() => {
    if (user?.role === "admin") {
      fetchAdminPendingListings()
        .then((d) => setBusinessCount(d.centres.length + d.clubs.length))
        .catch(() => setBusinessCount(0));
    } else if (user?.role === "vendor" && user.status === "approved") {
      fetchVendorListings()
        .then((d) => {
          const attention = (rows: { status: string }[]) => rows.filter((r) => r.status === "pending" || r.status === "rejected").length;
          setBusinessCount(attention(d.centres) + attention(d.clubs));
        })
        .catch(() => setBusinessCount(0));
    } else setBusinessCount(0);
  }, [user?.role, user?.status]);
  useEffect(loadBusiness, [loadBusiness]);
  useOnFocus(loadBusiness, !!user);

  // Vendor business notifications (the dashboard's Messages tab) — real unread rows.
  const [vendorUnread, setVendorUnread] = useState(0);
  const loadVendorNotifs = useCallback(() => {
    if (user?.role === "vendor" && user.status === "approved")
      fetchVendorNotifications()
        .then((rows) => setVendorUnread(rows.filter((r) => !r.read).length))
        .catch(() => setVendorUnread(0));
    else setVendorUnread(0);
  }, [user?.role, user?.status]);
  useEffect(loadVendorNotifs, [loadVendorNotifs]);
  useOnFocus(loadVendorNotifs, user?.role === "vendor");

  // Group-chat unread — the resident's own, or the host inbox for a vendor-only session.
  const [chatUnread, setChatUnread] = useState(0);
  const loadChats = useCallback(() => {
    if (!resident && !hostOnly) return setChatUnread(0);
    fetchChatInbox(hostOnly)
      .then((r) => setChatUnread(r.unread))
      .catch(() => {});
  }, [resident?.id, hostOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadChats();
    if (!resident && !hostOnly) return;
    const id = window.setInterval(loadChats, 60000);
    return () => window.clearInterval(id);
  }, [loadChats, resident, hostOnly]);
  useOnFocus(loadChats, !!resident || hostOnly);

  // Resident notifications (HC-QA-073: badge = the server's unread total).
  const [notifs, setNotifs] = useState<ResidentNotification[]>([]);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const loadNotifs = useCallback(() => {
    if (!resident) {
      setNotifs([]);
      setUnreadNotifs(0);
      return;
    }
    fetchResidentNotificationsPage(null, 20)
      .then((page) => {
        setNotifs(page.items);
        setUnreadNotifs(page.unread);
      })
      .catch(() => {});
  }, [resident?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadNotifs, [loadNotifs]);
  useOnFocus(loadNotifs, !!resident);

  const markRead = useCallback(async (id: number) => {
    await markResidentNotificationRead(id);
    setNotifs((rows) => rows.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
    setUnreadNotifs((n) => Math.max(0, n - 1));
  }, []);

  // HelloCircle Manage workspaces + "has ever hosted" (Host MVP Phase 3).
  const [workspaces, setWorkspaces] = useState<ManageWorkspaces | null>(null);
  const [hasHostedGames, setHasHostedGames] = useState(false);
  useEffect(() => {
    if (resident && samePerson) {
      fetchManageWorkspaces().then(setWorkspaces).catch(() => setWorkspaces(null));
      fetchMyGames({ hostedOnly: true })
        .then((games) => setHasHostedGames(games.length > 0))
        .catch(() => setHasHostedGames(false));
    } else {
      setWorkspaces(null);
      setHasHostedGames(false);
    }
  }, [resident?.id, user?.role, user?.residentId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { hostOnly, businessCount, vendorUnread, chatUnread, notifs, unreadNotifs, markRead, workspaces, hasHostedGames };
}
