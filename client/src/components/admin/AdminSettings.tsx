import { FolderTree, ListChecks } from "lucide-react";
import { AdminFieldPolicy } from "./AdminFieldPolicy";
import { fetchCategoriesEnabled, setCategoriesEnabled } from "../../api";
import { ConfirmDialog } from "../ui";
import { useState } from "react";
import { useAdminCan } from "./adminPermissions";
import { CheckCircle2, CircleAlert, CircleDot, Lock, Server, UserCog, CircleQuestionMark, Map as MapIcon, SlidersHorizontal } from "lucide-react";
import { fetchCircleFeatureSettings, fetchMapsEnabled, fetchSystemStatus, setCircleFeatureSetting, setMapsEnabled } from "../../api";
import { resetPaidCheckoutCache } from "../../paidCheckout";
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

// Category system — the site-wide switch for category navigation (gap review
// docs/hellocircle-category-gap-review.md §2). Off hides category chips,
// Home "Popular", category pickers and category SEO pages; categories and
// listing assignments are kept, so turning it back on restores everything.
function CategoriesSwitch() {
  const can = useAdminCan();
  const toast = useToast();
  const state = useAdminData(fetchCategoriesEnabled);
  const [confirming, setConfirming] = useState<boolean | null>(null);
  return (
    <Box icon={FolderTree} title="Categories on the site" subtitle="Category chips, the Home “Popular right now” row, host and partner category pickers, and category search pages.">
      <Loaded state={state} rows={1}>
        {(m) => (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <strong>{m.enabled ? "Categories are shown" : "Categories are hidden"}</strong>
              <div className="adm-note">
                {m.liveCategories} {m.liveCategories === 1 ? "category is" : "categories are"} in use · {m.categorisedListings} listings have a category
              </div>
            </div>
            {can("platform.settings") ? (
              <AdminButton onClick={() => setConfirming(!m.enabled)}>{m.enabled ? "Hide categories" : "Show categories"}</AdminButton>
            ) : (
              <span className="adm-note">Only a super admin can change this.</span>
            )}
          </div>
        )}
      </Loaded>
      <ConfirmDialog
        open={confirming !== null}
        tone={confirming === false ? "danger" : "neutral"}
        title={confirming === false ? "Hide categories across the site?" : "Show categories across the site?"}
        message={
          confirming === false
            ? "Category chips, the Home “Popular right now” row and category search pages disappear, and hosts and partners stop seeing the category field. No category or listing assignment is deleted — showing them again restores everything. Takes effect within a few seconds and is recorded in the audit log."
            : "Category chips, the Home “Popular right now” row, category search pages and the host and partner category fields come back with the existing categories and assignments. Recorded in the audit log."
        }
        confirmLabel={confirming === false ? "Hide categories" : "Show categories"}
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          const next = await setCategoriesEnabled(confirming!);
          state.setData({ ...(state.data ?? { liveCategories: 0, categorisedListings: 0 }), enabled: next.enabled });
          toast.success(next.enabled ? "Categories are shown" : "Categories are hidden");
          setConfirming(null);
        }}
      />
    </Box>
  );
}

// Circle Experience 2.0 — one runtime switch per new Circle feature
// (server/src/circleFeatures.ts), all off by default until verified. Same
// permission (platform.settings) and audit trail as the maps switch.
function CircleFeaturesSwitches() {
  const can = useAdminCan();
  const toast = useToast();
  const state = useAdminData(fetchCircleFeatureSettings);
  const [busy, setBusy] = useState<string | null>(null);
  const flip = async (key: string, enabled: boolean) => {
    setBusy(key);
    try {
      const next = await setCircleFeatureSetting(key, enabled);
      state.setData({ features: (state.data?.features ?? []).map((f) => (f.key === key ? { ...f, enabled: next.enabled } : f)) });
      resetPaidCheckoutCache();
      toast.success(`${state.data?.features.find((f) => f.key === key)?.label ?? "Feature"} is ${enabled ? "on" : "off"}`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't change that switch"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Box icon={CircleDot} title="New features" subtitle="Circle and discovery tools. Off by default; each can be switched on or off on its own, within a few seconds, with no redeploy. Every change is recorded in the audit log.">
      <Loaded state={state} rows={8}>
        {(m) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>{(["circles", "experience", "participation"] as const).map((group) => (<section key={group}><h3 className="adm-note" style={{ textTransform: "uppercase", fontWeight: 800, margin: "0 0 10px" }}>{group === "circles" ? "Circles" : group === "experience" ? "Discovery and My Life" : "Community events and registration"}</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            {m.features.filter((f) => (f.group ?? "circles") === group).map((f) => (
              <li key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                  <strong>
                    {f.label} · {f.enabled ? "On" : "Off"}
                  </strong>
                  <div className="adm-note">{f.description}</div>
                </div>
                {f.locked && !f.enabled ? (
                  <span className="adm-note">Locked — needs the owner's approval before it can be switched on.</span>
                ) : can("platform.settings") ? (
                  <AdminButton disabled={busy === f.key} onClick={() => flip(f.key, !f.enabled)}>
                    {f.enabled ? `Turn ${f.label} off` : `Turn ${f.label} on`}
                  </AdminButton>
                ) : (
                  <span className="adm-note">Only a super admin can change this.</span>
                )}
              </li>
            ))}
          </ul></section>))}</div>
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
  { key: "fields", label: "Registration fields", icon: ListChecks },
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
          <CategoriesSwitch />
          <CircleFeaturesSwitches />
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
      {section === "fields" && <AdminFieldPolicy />}
    </div>
  );
}
