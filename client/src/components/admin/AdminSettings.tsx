import { useState } from "react";
import { useAdminCan } from "./adminPermissions";
import { CheckCircle2, CircleAlert, Lock, Server, UserCog, CircleQuestionMark, Map as MapIcon, SlidersHorizontal } from "lucide-react";
import { fetchMapsEnabled, fetchSystemStatus, setMapsEnabled } from "../../api";
import { useToast } from "../Toast";
import { HelpSection, RolesSection } from "../AdminFinance";
import { AdminInvitesCard, AdminTwoStepCard } from "./AdminTeamAccess";
import { MarketConfig } from "../MarketConfig";
import { RecommendationWeightsCard } from "../RecommendationWeightsCard";
import { ADMIN_ROLE_LABEL, type AdminRoleName } from "./adminNav";
import { AdminButton, Box, Loaded, errorMessage, useAdminData, IconTabs } from "./adminUi";
import { useUrlParam } from "../../useUrlTab";

// Settings (admin redesign 2026-10-14) — not a new feature: it gathers
// platform-configuration tools that used to be scattered (system status was
// under Audit; admin roles + field help under Finance; market categories +
// For You weights under Marketplace health). Every control here is the same
// component, calling the same endpoint, as before.

function Restricted({ title, roles }: { title: string; roles: AdminRoleName[] }) {
  return (
    <Box icon={Lock} title={title}>
      <p className="adm-note" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Lock size={18} strokeWidth={1.9} aria-hidden="true" />
        Needs the {roles.map((r) => ADMIN_ROLE_LABEL[r].toLowerCase()).join(" or ")} role.
      </p>
    </Box>
  );
}

function SystemStatus() {
  const state = useAdminData(fetchSystemStatus);
  return (
    <Box icon={Server} title="System status" subtitle="Best-effort checks: whether each integration is configured, not live monitoring.">
      <Loaded state={state} rows={1}>
        {(s) => (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "10px 28px" }}>
            {(
              [
                ["Database", s.database === "ok", s.database === "ok" ? "Reachable" : "Not reachable"],
                ["Stripe", s.stripeConfigured, s.stripeConfigured ? "Configured" : "Not configured"],
                ["Email (SMTP)", s.smtpConfigured, s.smtpConfigured ? "Configured" : "Not configured, so emails are only logged"],
              ] as const
            ).map(([label, ok, text]) => (
              <li key={label} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                {ok ? (
                  <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden="true" style={{ color: "var(--color-green-text)" }} />
                ) : (
                  <CircleAlert size={18} strokeWidth={1.9} aria-hidden="true" style={{ color: "var(--color-orange-dark)" }} />
                )}
                <strong>{label}</strong>
                <span style={{ color: "var(--color-muted)" }}>{text}</span>
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </Box>
  );
}

// OG-31 — the runtime maps switch (it was API-only). Turning maps off hides
// every map and stops map requests; listings and search keep working.
function MapsSwitch() {
  const can = useAdminCan();
  const toast = useToast();
  const state = useAdminData(fetchMapsEnabled);
  const [busy, setBusy] = useState(false);
  const flip = async (enabled: boolean) => {
    setBusy(true);
    try {
      state.setData(await setMapsEnabled(enabled));
      toast.success(enabled ? "Maps are on" : "Maps are off");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't change the maps switch"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box icon={MapIcon} title="Maps" subtitle="Turn maps off to stop map costs at once. Listings, search and booking keep working without them.">
      <Loaded state={state} rows={1}>
        {(m) => (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <strong>{m.enabled ? "Maps are on" : "Maps are off"}</strong>
            {can("platform.settings") ? (
              <AdminButton disabled={busy} onClick={() => flip(!m.enabled)}>
                {m.enabled ? "Turn maps off" : "Turn maps on"}
              </AdminButton>
            ) : (
              <span className="adm-note">Only a super admin can change this.</span>
            )}
          </div>
        )}
      </Loaded>
    </Box>
  );
}

const SECTIONS = [
  { key: "status", label: "System status", icon: Server },
  { key: "roles", label: "Admin roles", icon: UserCog },
  { key: "help", label: "Field help", icon: CircleQuestionMark },
  { key: "market", label: "Market categories", icon: MapIcon },
  { key: "weights", label: "For You weights", icon: SlidersHorizontal },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

/** One settings tool at a time (2026-10-16); the page used to stack all five (~4,300px). */
export function AdminSettingsPage() {
  const can = useAdminCan();
  const [param, setSection] = useUrlParam<string>("section", "status");
  const section: SectionKey = SECTIONS.some((x) => x.key === param) ? (param as SectionKey) : "status";
  return (
    <div className="adm-stack">
      <IconTabs label="Settings sections" value={section} onChange={(k) => setSection(k)} items={SECTIONS.map((x) => ({ key: x.key, label: x.label, icon: x.icon }))} />
      {section === "status" && (
        <div className="adm-stack">
          <SystemStatus />
          <MapsSwitch />
        </div>
      )}
      {section === "roles" &&
        (can("admins.manage") ? (
          <div className="adm-stack">
            <RolesSection />
            <AdminInvitesCard />
            <AdminTwoStepCard />
          </div>
        ) : (
          <Restricted title="Admin roles" roles={["super"]} />
        ))}
      {section === "help" && (can("help.edit") ? <HelpSection /> : <Restricted title="Field help" roles={["legal"]} />)}
      {section === "market" && (can("platform.settings") ? <MarketConfig /> : <Restricted title="Market categories" roles={["super"]} />)}
      {section === "weights" && (can("platform.settings") ? <RecommendationWeightsCard /> : <Restricted title="For You weights" roles={["super"]} />)}
    </div>
  );
}
