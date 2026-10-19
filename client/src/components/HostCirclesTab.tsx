import { useNavigate } from "react-router-dom";
import { fetchMyCircles } from "../api";
import { Users } from "lucide-react";
import { EmptyState } from "./ui";
import { AdminButton, Box, Loaded, useAdminData } from "./admin/adminUi";
import { WsListTable } from "./workspace/WsListTable";
import type { Circle } from "../types";

// HelloCircle Manage — Circles tab body (companion to HostActivitiesTab.tsx),
// rendered as a tab of the combined ManageHome dashboard. Mirrors Vendor's
// own Listings tab → per-listing editor relationship: this tab is a flat
// list of every Circle you organise, and "Manage" on a row still drills
// into that one circle's own Plans/Members/Settings at the existing
// /manage/circles/:id route (ManageCircle.tsx) — unchanged, since a
// specific circle's management is inherently per-entity, not something a
// shared tab can represent (same reason Vendor's centre/club editors are
// their own route, not a Listings sub-tab).

export function CirclesTab() {
  const state = useAdminData<Circle[]>(() => fetchMyCircles());
  return (
    <Loaded state={state} title="Couldn't load your Circles">
      {(circles) => <CirclesList circles={circles} />}
    </Loaded>
  );
}

function CirclesList({ circles }: { circles: Circle[] }) {
  const navigate = useNavigate();
  const organising = circles.filter((c) => c.myRole === "organiser");
  const open = (c: Circle) => navigate(`/manage/circles/${c.slug ?? c.id}`);

  return (
    <Box flush>
      {organising.length === 0 ? (
        <EmptyState
          icon={<Users size={20} />}
          title="You aren't organising a Circle yet"
          subtitle="A Circle is a group that meets regularly around one activity."
          action={
            <AdminButton variant="primary" onClick={() => navigate("/circles/start")}>
              Start a Circle
            </AdminButton>
          }
        />
      ) : (
        <WsListTable
          caption="Circles you organise"
          columns={[{ label: "Circle" }, { label: "Status" }, { label: "Members", num: true }, { label: "Plans this month", num: true }]}
          rows={organising.map((c) => ({
            key: c.id,
            name: c.name,
            title: c.name,
            detail: c.activityLabel,
            leading: (
              <span className="ws-thumb ws-thumb--empty" aria-hidden="true">
                <Users size={18} strokeWidth={1.9} />
              </span>
            ),
            cells: [
              <span className="adm-chip" data-tone={c.status === "closed" ? undefined : "good"}>
                {c.status === "closed" ? "Closed" : "Active"}
              </span>,
              c.members,
              c.plansThisMonth,
            ],
            onOpen: () => open(c),
            openLabel: "Manage",
            menu: [{ label: "View public page", onSelect: () => navigate(`/circles/${c.slug ?? c.id}`) }],
          }))}
        />
      )}
    </Box>
  );
}
