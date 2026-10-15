import { useAdminCan } from "./adminPermissions";
import { CheckCircle2, CircleAlert, Lock } from "lucide-react";
import { fetchSystemStatus } from "../../api";
import { HelpSection, RolesSection } from "../AdminFinance";
import { MarketConfig } from "../MarketConfig";
import { RecommendationWeightsCard } from "../RecommendationWeightsCard";
import { ADMIN_ROLE_LABEL, type AdminRoleName } from "./adminNav";
import { Box, Loaded, useAdminData } from "./adminUi";

// Settings (admin redesign 2026-10-14) — not a new feature: it gathers
// platform-configuration tools that used to be scattered (system status was
// under Audit; admin roles + field help under Finance; market categories +
// For You weights under Marketplace health). Every control here is the same
// component, calling the same endpoint, as before.

function Restricted({ title, roles }: { title: string; roles: AdminRoleName[] }) {
  return (
    <Box title={title}>
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
    <Box title="System status" subtitle="Best-effort checks — whether each integration is configured, not live monitoring.">
      <Loaded state={state} rows={1}>
        {(s) => (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "10px 28px" }}>
            {(
              [
                ["Database", s.database === "ok", s.database === "ok" ? "Reachable" : "Not reachable"],
                ["Stripe", s.stripeConfigured, s.stripeConfigured ? "Configured" : "Not configured"],
                ["Email (SMTP)", s.smtpConfigured, s.smtpConfigured ? "Configured" : "Not configured — emails are logged only"],
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

export function AdminSettingsPage() {
  const can = useAdminCan();
  return (
    <div className="adm-stack">
      <nav aria-label="Settings sections" style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13.5 }}>
        {[
          ["#adm-set-status", "System status"],
          ["#adm-set-roles", "Admin roles"],
          ["#adm-set-help", "Field help"],
          ["#adm-set-market", "Market categories"],
          ["#adm-set-weights", "For You weights"],
        ].map(([href, label]) => (
          <a key={href} href={href} style={{ color: "var(--color-text)", fontWeight: 700 }}>
            {label}
          </a>
        ))}
      </nav>
      <div id="adm-set-status">
        <SystemStatus />
      </div>
      <div id="adm-set-roles">{can("admins.manage") ? <RolesSection /> : <Restricted title="Admin roles" roles={["super"]} />}</div>
      <div id="adm-set-help">{can("help.edit") ? <HelpSection /> : <Restricted title="Field help" roles={["legal"]} />}</div>
      <div id="adm-set-market">{can("platform.settings") ? <MarketConfig /> : <Restricted title="Market categories" roles={["super"]} />}</div>
      <div id="adm-set-weights">{can("platform.settings") ? <RecommendationWeightsCard /> : <Restricted title="For You weights" roles={["super"]} />}</div>
    </div>
  );
}
