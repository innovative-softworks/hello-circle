import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  adminDeleteCentre,
  adminDeleteClub,
  createAdminCoupon,
  createAdminOrganisation,
  deleteAdminCoupon,
  fetchActivityOverview,
  fetchAdminCoupons,
  fetchAdminDemand,
  fetchAdminIntentClusters,
  fetchAdminReferrals,
  fetchAnalyticsFunnel,
  fetchMarketplaceHealth,
  notifyIntentCluster,
  fetchAdminListings,
  fetchAdminOrganisations,
  fetchAdminPlaceSuggestions,
  fetchNotificationTemplates,
  fetchOrgFeatureFlags,
  fetchAdminReviews,
  fetchAdminStats,
  fetchAdminVendors,
  fetchAuditLog,
  fetchClaims,
  fetchHostApplications,
  fetchModerationReports,
  fetchReportCase,
  fetchSystemStatus,
  hideReview,
  resolveReport,
  setAdminCouponActive,
  setCentreOrganisation,
  setCentreStatus,
  setClaimStatus,
  setClubOrganisation,
  setClubStatus,
  resetNotificationTemplate,
  setHostApplicationStatus,
  setListingFeatured,
  setNotificationTemplate,
  setOrgFeatureFlag,
  setPlaceSuggestionStatus,
  setVendorPlatformRole,
  setVendorProviderTier,
  setVendorStatus,
  supportSearch,
  unhideReview,
  type AdminCoupon,
  type AdminListingSummary,
  type AdminVendor,
  type ClaimSummary,
  type HostApplication,
} from "../api";
import { useAuth } from "../AuthContext";
import { ManageShell } from "../components/ManageShell";
import { AwardIcon, BallIcon, BuildingIcon, CalendarIcon, CheckIcon, ClipboardIcon, EyeIcon, GridIcon, IdCardIcon, MailIcon, PhotoStackIcon, PinIcon, SearchIcon, StarIcon, TagIcon, TrendUpIcon, UsersIcon } from "../components/icons";
import { Avatar, BadgedIcon, Button, ManageCard as Card, ConfirmDialog, DashboardTopPanel, Drawer, EmptyState, onActivateProps, PageSpinner, StarDisplay, KpiHero, KpiStrip, StatTile, StatusBadge, inputStyle, labelStyle, tableStyle, tdStyle, thStyle, type ListingStatus } from "../components/ui";
import { AdminMediaTab } from "../components/AdminMedia";
import { DemandSignalsView, IntentClusterView } from "../components/DemandSignals";
import { MarketplaceHealthView } from "../components/MarketplaceHealth";
import { MarketConfig } from "../components/MarketConfig";
import { getMediaUrl } from "../media";
import { colors, fonts, radius } from "../theme";
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_LABELS, PLATFORM_ROLE_LABELS } from "../types";
import type { AdminOrganisation, AdminStats, AnalyticsFunnelRow, AuditEntry, CircleActivity, DemandRow, FeatureFlagKey, FeatureFlags, IntentCluster, MarketplaceHealth, ModerationReport, NotificationTemplateInfo, OpenBookingActivity, PlaceSuggestion, ReferralAttributionRow, ReportCase, Review, SupportBooking, SupportCircle, SupportGame, SupportRegistration, SupportUser } from "../types";

const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"];

function vendorTypePill(vendorType: "community" | "sports" | null) {
  if (!vendorType) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: radius.pill,
        background: vendorType === "sports" ? colors.orangeBg : colors.greenBg,
        color: vendorType === "sports" ? colors.orangeDark : colors.greenText,
      }}
    >
      {vendorType === "sports" ? <BallIcon size={11} /> : <BuildingIcon size={11} />}
      {vendorType === "sports" ? "Sports club" : "Community"}
    </span>
  );
}

function VendorDrawer({
  vendor,
  vendors,
  organisations,
  listings,
  onChanged,
  onClose,
  onOpenListing,
}: {
  vendor: AdminVendor | null;
  vendors: AdminVendor[];
  organisations: AdminOrganisation[];
  listings: { centres: AdminListingSummary[]; clubs: AdminListingSummary[] };
  onChanged: () => void;
  onClose: () => void;
  onOpenListing: (type: "centre" | "club", id: string) => void;
}) {
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);
  const [platformRole, setPlatformRoleLocal] = useState(vendor?.platformRole ?? "none");
  const [providerTier, setProviderTierLocal] = useState(vendor?.providerTier ?? "standard");
  const [savingRole, setSavingRole] = useState(false);

  useEffect(() => {
    setPlatformRoleLocal(vendor?.platformRole ?? "none");
    setProviderTierLocal(vendor?.providerTier ?? "standard");
  }, [vendor?.id, vendor?.platformRole, vendor?.providerTier]);

  if (!vendor) return null;

  const roleDirty = platformRole !== (vendor.platformRole ?? "none") || providerTier !== vendor.providerTier;
  const saveRole = async () => {
    setSavingRole(true);
    try {
      await Promise.all([
        setVendorPlatformRole(vendor.id, platformRole === "none" ? null : platformRole),
        setVendorProviderTier(vendor.id, providerTier as "standard" | "verified" | "featured"),
      ]);
      onChanged();
    } finally {
      setSavingRole(false);
    }
  };

  const org = organisations.find((o) => o.id === vendor.orgId) ?? null;
  const orgMemberCount = vendor.orgId ? vendors.filter((v) => v.orgId === vendor.orgId).length : 0;
  const ownListings = [
    ...listings.centres.filter((c) => c.vendorId === vendor.id).map((c) => ({ ...c, type: "centre" as const })),
    ...listings.clubs.filter((c) => c.vendorId === vendor.id).map((c) => ({ ...c, type: "club" as const })),
  ];

  return (
    <Drawer open onClose={onClose} title={vendor.name}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <Avatar name={vendor.name} size={40} />
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <StatusBadge status={vendor.status} />
            {vendorTypePill(vendor.vendorType)}
          </div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 3 }}>{vendor.email}</div>
        </div>
      </div>

      {vendor.businessName && <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{vendor.businessName}</div>}
      {(vendor.address || vendor.county || vendor.mobile || vendor.landline) && (
        <div style={{ fontSize: 12.5, color: colors.mutedLight, marginBottom: 4 }}>
          {[vendor.address, vendor.county, vendor.mobile, vendor.landline && `${vendor.landline} (landline)`].filter(Boolean).join(" · ")}
        </div>
      )}
      {vendor.description && <div style={{ fontSize: 12.5, color: colors.muted, marginBottom: 18 }}>{vendor.description}</div>}

      <h5 style={{ fontFamily: fonts.display, fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: ".03em" }}>
        Account status
      </h5>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {vendor.status !== "approved" && <Button variant="dark" onClick={() => setVendorStatus(vendor.id, "approved").then(onChanged)}>Approve</Button>}
        {vendor.status !== "suspended" && <Button variant="ghost" onClick={() => setConfirmingSuspend(true)}>Suspend</Button>}
        {vendor.status === "suspended" && <Button variant="ghost" onClick={() => setVendorStatus(vendor.id, "approved").then(onChanged)}>Reinstate</Button>}
      </div>

      <h5 style={{ fontFamily: fonts.display, fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: ".03em" }}>
        Platform role &amp; tier
      </h5>
      {!vendor.invitedStaff && (
        <p style={{ fontSize: 12, color: colors.faint, margin: "0 0 8px" }}>
          This is the organisation owner — owners always have full access regardless of role. Role only restricts invited staff.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={platformRole}
          onChange={(e) => setPlatformRoleLocal(e.target.value)}
          style={{ ...inputStyle, width: 170, padding: "8px 10px", fontSize: 13 }}
        >
          <option value="none">— no role —</option>
          {PLATFORM_ROLES.map((r) => (
            <option key={r} value={r}>{PLATFORM_ROLE_LABELS[r as keyof typeof PLATFORM_ROLE_LABELS]}</option>
          ))}
        </select>
        <select
          value={providerTier}
          onChange={(e) => setProviderTierLocal(e.target.value as "standard" | "verified" | "featured")}
          style={{ ...inputStyle, width: 130, padding: "8px 10px", fontSize: 13 }}
        >
          <option value="standard">Standard</option>
          <option value="verified">Verified</option>
          <option value="featured">Featured</option>
        </select>
        <Button onClick={saveRole} disabled={!roleDirty || savingRole}>
          {savingRole ? "Saving…" : "Save"}
        </Button>
      </div>

      <h5 style={{ fontFamily: fonts.display, fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: ".03em" }}>
        Organisation
      </h5>
      <div style={{ fontSize: 13, marginBottom: 20 }}>
        {org ? (
          <span>{org.name} · {orgMemberCount} {orgMemberCount === 1 ? "member" : "members"}</span>
        ) : (
          <span style={{ color: colors.faint }}>No organisation linked</span>
        )}
      </div>

      <h5 style={{ fontFamily: fonts.display, fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: ".03em" }}>
        Listings ({ownListings.length})
      </h5>
      {ownListings.length === 0 ? (
        <span style={{ fontSize: 13, color: colors.faint }}>No listings yet.</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ownListings.map((l) => (
            <button
              key={`${l.type}:${l.id}`}
              onClick={() => onOpenListing(l.type, l.id)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: colors.panel,
                border: "none",
                borderRadius: radius.control,
                padding: "9px 12px",
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span>{l.name}</span>
              <StatusBadge status={l.status as ListingStatus} />
            </button>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmingSuspend}
        title={`Suspend ${vendor.name}?`}
        message="They'll lose dashboard access until reinstated. Their listings stay visible unless you also remove them — this is reversible any time."
        confirmLabel="Suspend"
        onConfirm={() => { setConfirmingSuspend(false); setVendorStatus(vendor.id, "suspended").then(onChanged); }}
        onCancel={() => setConfirmingSuspend(false)}
      />
    </Drawer>
  );
}

function VendorsTab({
  onOpenListing,
  openRequest,
  onOpenRequestHandled,
}: {
  onOpenListing: (type: "centre" | "club", id: string) => void;
  openRequest?: string | null;
  onOpenRequestHandled?: () => void;
}) {
  const [vendors, setVendors] = useState<AdminVendor[]>([]);
  const [organisations, setOrganisations] = useState<AdminOrganisation[]>([]);
  const [listings, setListings] = useState<{ centres: AdminListingSummary[]; clubs: AdminListingSummary[] }>({ centres: [], clubs: [] });
  const [openId, setOpenId] = useState<string | null>(null);

  const load = () => fetchAdminVendors().then(setVendors);
  useEffect(() => { load(); }, []);
  useEffect(() => { fetchAdminOrganisations().then(setOrganisations); }, []);
  useEffect(() => { fetchAdminListings().then(setListings); }, []);
  useEffect(() => {
    if (openRequest) {
      setOpenId(openRequest);
      onOpenRequestHandled?.();
    }
  }, [openRequest, onOpenRequestHandled]);

  const openVendor = vendors.find((v) => v.id === openId) ?? null;

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {vendors.map((v) => (
        <Card key={v.id} hover onClick={() => setOpenId(v.id)} style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <Avatar name={v.name} size={36} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{v.name}</span>
                <StatusBadge status={v.status} />
                {vendorTypePill(v.vendorType)}
              </div>
              <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>{v.email} · {v.centreCount} centres · {v.clubCount} clubs</div>
            </div>
          </div>
          <Button variant="ghost" onClick={() => setOpenId(v.id)}>View</Button>
        </Card>
      ))}
      {vendors.length === 0 && <EmptyState icon={<UsersIcon size={26} />} title="No vendors yet" />}
      <VendorDrawer
        vendor={openVendor}
        vendors={vendors}
        organisations={organisations}
        listings={listings}
        onChanged={() => { load(); fetchAdminListings().then(setListings); }}
        onClose={() => setOpenId(null)}
        onOpenListing={(type, id) => { setOpenId(null); onOpenListing(type, id); }}
      />
    </div>
  );
}

function ClaimsTab() {
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const load = () => fetchClaims().then(setClaims);
  useEffect(() => { load(); }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {claims.map((c) => {
        // A claim can't be approved before the claiming vendor's own account
        // has been vetted — mirrors ListingRow's vendorNotApproved guard.
        const vendorNotApproved = c.vendorStatus !== "approved";
        return (
          <Card key={c.id} hover style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
              <Avatar name={c.vendorName} size={36} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{c.listingName}</span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: radius.pill,
                      background: c.listingType === "club" ? colors.orangeBg : colors.greenBg,
                      color: c.listingType === "club" ? colors.orangeDark : colors.greenText,
                    }}
                  >
                    {c.listingType === "club" ? <BallIcon size={11} /> : <BuildingIcon size={11} />}
                    {c.listingType === "club" ? "Sports club" : "Community centre"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>
                  Claimed by {c.vendorName} · {c.vendorEmail}
                  {vendorNotApproved && ` (vendor account ${c.vendorStatus})`}
                </div>
                {c.message && <div style={{ fontSize: 12, color: colors.muted, marginTop: 6, maxWidth: 480 }}>{c.message}</div>}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flex: "none" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="dark" disabled={vendorNotApproved} onClick={() => setClaimStatus(c.id, "approved").then(load)}>
                  Approve
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingId(c.id)}>
                  Reject
                </Button>
              </div>
              {vendorNotApproved && <span style={{ fontSize: 11, color: colors.orangeDark }}>Approve the vendor account first</span>}
            </div>
          </Card>
        );
      })}
      {claims.length === 0 && <EmptyState icon={<IdCardIcon size={26} />} title="No claims waiting on you" subtitle="No listing claims are pending review." />}

      <ConfirmDialog
        open={confirmingId !== null}
        title="Reject this claim?"
        message="The vendor will need to submit a new claim if they still want this listing. This can be reversed by approving a future claim."
        confirmLabel="Reject"
        onConfirm={() => { if (confirmingId !== null) setClaimStatus(confirmingId, "rejected").then(load); setConfirmingId(null); }}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}

// "Host" trust tier (IA spec five-layer audit) — badge-only queue, mirrors
// ClaimsTab's approve/reject-with-confirm shape exactly.
function HostApplicationsTab() {
  const [applications, setApplications] = useState<HostApplication[]>([]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const load = () => fetchHostApplications().then(setApplications);
  useEffect(() => { load(); }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {applications.map((a) => (
        <Card key={a.id} style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
            <Avatar name={a.name} size={36} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</div>
              <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>
                {a.email}{a.phone ? ` · ${a.phone}` : ""} · applied {new Date(a.appliedAt).toLocaleDateString()}
              </div>
              {a.bio && <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 6, maxWidth: 480 }}>{a.bio}</div>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <Button variant="dark" onClick={() => setHostApplicationStatus(a.id, "verified").then(load)}>
              Approve
            </Button>
            <Button variant="ghost" onClick={() => setRejectingId(a.id)}>
              Reject
            </Button>
          </div>
        </Card>
      ))}
      {applications.length === 0 && <EmptyState icon={<AwardIcon size={26} />} title="No host applications waiting on you" />}

      <ConfirmDialog
        open={rejectingId !== null}
        title="Reject this host application?"
        message="The resident can still host a Game or Circle either way — this just declines the Verified Host badge. They're welcome to reapply."
        confirmLabel="Reject"
        onConfirm={() => { if (rejectingId !== null) setHostApplicationStatus(rejectingId, "rejected").then(load); setRejectingId(null); }}
        onCancel={() => setRejectingId(null)}
      />
    </div>
  );
}

function PlaceSuggestionsTab() {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const load = () => fetchAdminPlaceSuggestions().then(setSuggestions);
  useEffect(() => { load(); }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {suggestions.map((s) => (
        <Card key={s.id} style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {s.suggestedName} <span style={{ fontWeight: 500, color: colors.mutedLight, fontSize: 12 }}>({s.category})</span>
            </div>
            <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>
              {[s.area, s.county].filter(Boolean).join(", ") || "No location given"} · submitted {new Date(s.createdAt).toLocaleDateString()}
            </div>
            {s.description && <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 6, maxWidth: 480 }}>{s.description}</div>}
            {s.contactInfo && <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 4 }}>Contact: {s.contactInfo}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <Button variant="dark" onClick={() => setPlaceSuggestionStatus(s.id, "approved").then(load)}>
              Approve & publish
            </Button>
            <Button variant="ghost" onClick={() => setRejectingId(s.id)}>
              Reject
            </Button>
          </div>
        </Card>
      ))}
      {suggestions.length === 0 && <EmptyState icon={<PinIcon size={26} />} title="No place suggestions waiting on you" />}

      <ConfirmDialog
        open={rejectingId !== null}
        title="Reject this suggestion?"
        message="No listing will be created. The person who submitted it can see the status if they check back."
        confirmLabel="Reject"
        onConfirm={() => { if (rejectingId !== null) setPlaceSuggestionStatus(rejectingId, "rejected").then(load); setRejectingId(null); }}
        onCancel={() => setRejectingId(null)}
      />
    </div>
  );
}

function listingFacts(item: AdminListingSummary, type: "centre" | "club") {
  // Area already includes the county for seeded listings ("Cabra, Dublin")
  // but not necessarily for vendor-entered ones, so only append county when
  // it isn't already part of the area string — avoids "Cabra, Dublin,
  // Dublin" while still showing it when it's missing.
  const areaLine =
    item.county && !item.area.toLowerCase().includes(item.county.toLowerCase())
      ? [item.area, item.county].filter(Boolean).join(", ")
      : item.area;
  return [
    areaLine,
    type === "centre"
      ? [item.capacity ? `cap ${item.capacity}` : null, item.from ? `from €${item.from}/hr` : null].filter(Boolean).join(" · ")
      : [item.sport, item.ages, item.price ? `€${item.price}/${item.unit}` : null].filter(Boolean).join(" · "),
  ].filter(Boolean);
}

function ListingRow({
  item,
  type,
  onOpen,
  onChanged,
}: {
  item: AdminListingSummary;
  type: "centre" | "club";
  onOpen: () => void;
  onChanged: () => void;
}) {
  const setStatus = type === "centre" ? setCentreStatus : setClubStatus;
  // A listing can't go live before its vendor's account has been vetted.
  // Grandfathered listings with no vendor (vendorStatus null) are exempt.
  const vendorNotApproved = !!item.vendorStatus && item.vendorStatus !== "approved";
  const facts = listingFacts(item, type);
  const [confirmingReject, setConfirmingReject] = useState(false);

  return (
    <Card hover onClick={onOpen} style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
        {item.image && (
          <img src={getMediaUrl(item.image, "thumbnail")} alt="" style={{ width: 44, height: 44, borderRadius: radius.control, objectFit: "cover", flex: "none" }} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</span>
            <StatusBadge status={item.status as ListingStatus} />
            {/* Bounded "featured" flag (IA spec §16) — the entire CMS
                surface: toggle, no scheduling/placement rules. */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setListingFeatured(type === "centre" ? "centres" : "clubs", item.id, !item.featured).then(onChanged);
              }}
              title={item.featured ? "Remove from featured" : "Feature this listing"}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: item.featured ? "#E0A22B" : colors.faint, display: "inline-flex" }}
            >
              <StarIcon size={15} />
            </button>
          </div>
          {item.vendorEmail && (
            <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>
              {item.vendorName ? `${item.vendorName} · ` : ""}{item.vendorEmail}
            </div>
          )}
          {facts.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: colors.mutedLight, marginTop: 4 }}>
              {facts.map((f, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {i === 0 ? <PinIcon size={12} /> : null}
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flex: "none" }}>
        {item.status === "pending" && (
          <div style={{ display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
            <Button variant="dark" disabled={vendorNotApproved} onClick={() => setStatus(item.id, "approved").then(onChanged)}>
              Approve
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingReject(true)}>Reject</Button>
          </div>
        )}
        {vendorNotApproved && item.status === "pending" && (
          <span style={{ fontSize: 11, color: colors.orangeDark }}>Approve the vendor account first</span>
        )}
        <Button variant="ghost" onClick={onOpen}>View</Button>
      </div>
      {/* Wrapper stops the click from bubbling to the Card's onClick={onOpen}
          — a React portal's events still bubble through the React tree
          (not the DOM tree), so without this, confirming here would also
          open the drawer. Same pattern the sibling Approve/Reject div uses. */}
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmDialog
          open={confirmingReject}
          title={`Reject ${item.name}?`}
          message="The vendor will need to fix and resubmit this listing before it can go live."
          confirmLabel="Reject"
          tone="neutral"
          onConfirm={() => {
            setConfirmingReject(false);
            setStatus(item.id, "rejected").then(onChanged);
          }}
          onCancel={() => setConfirmingReject(false)}
        />
      </div>
    </Card>
  );
}

function ListingDrawer({
  item,
  type,
  organisations,
  onChanged,
  onClose,
}: {
  item: AdminListingSummary | null;
  type: "centre" | "club";
  organisations: AdminOrganisation[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);

  if (!item) return null;
  const setStatus = type === "centre" ? setCentreStatus : setClubStatus;
  const setOrg = type === "centre" ? setCentreOrganisation : setClubOrganisation;
  const del = type === "centre" ? adminDeleteCentre : adminDeleteClub;
  const vendorNotApproved = !!item.vendorStatus && item.vendorStatus !== "approved";
  const facts = listingFacts(item, type);

  return (
    <Drawer open onClose={onClose} title={item.name}>
      {item.image && <img src={getMediaUrl(item.image, "card")} alt="" style={{ width: "100%", height: 160, borderRadius: 12, objectFit: "cover", marginBottom: 16 }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <StatusBadge status={item.status as ListingStatus} />
      </div>
      {item.vendorEmail && (
        <div style={{ fontSize: 13, color: colors.mutedLight, marginBottom: 6 }}>
          {item.vendorName ? `${item.vendorName} · ` : ""}{item.vendorEmail}
        </div>
      )}
      {facts.length > 0 && (
        <div style={{ fontSize: 13, color: colors.muted, marginBottom: 10 }}>{facts.join(" · ")}</div>
      )}
      {item.blurb && <div style={{ fontSize: 13, color: colors.muted, marginBottom: 20 }}>{item.blurb}</div>}

      <h5 style={{ fontFamily: fonts.display, fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: ".03em" }}>
        Moderation
      </h5>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        {item.status !== "approved" && (
          <Button variant="dark" disabled={vendorNotApproved} onClick={() => setStatus(item.id, "approved").then(onChanged)}>
            Approve
          </Button>
        )}
        {item.status !== "rejected" && <Button variant="ghost" onClick={() => setConfirmingReject(true)}>Reject</Button>}
        <Button variant="danger" onClick={() => setConfirmingDelete(true)}>Delete</Button>
      </div>
      {vendorNotApproved && (
        <span style={{ fontSize: 11, color: colors.orangeDark, display: "block", marginBottom: 20 }}>Approve the vendor account first</span>
      )}

      {organisations.length > 0 && (
        <>
          <h5 style={{ fontFamily: fonts.display, fontSize: 12, fontWeight: 700, color: colors.muted, margin: "20px 0 4px", textTransform: "uppercase", letterSpacing: ".03em" }}>
            Organisation
          </h5>
          <p style={{ fontSize: 11.5, color: colors.faint, margin: "0 0 8px" }}>
            Experimental — assigning this doesn't affect visibility or access yet.
          </p>
          <select
            defaultValue=""
            onChange={(e) => setOrg(item.id, e.target.value || null).then(onChanged)}
            style={{ ...inputStyle, width: 220, padding: "8px 10px", fontSize: 13 }}
          >
            <option value="" disabled>Assign organisation…</option>
            <option value="">— none —</option>
            {organisations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${item.name}?`}
        message="This removes it from public view and the vendor's dashboard. Existing bookings/registrations already made are unaffected."
        confirmLabel="Delete"
        onConfirm={() => { setConfirmingDelete(false); del(item.id).then(onChanged); }}
        onCancel={() => setConfirmingDelete(false)}
      />
      <ConfirmDialog
        open={confirmingReject}
        title={`Reject ${item.name}?`}
        message="The vendor will need to fix and resubmit this listing before it can go live."
        confirmLabel="Reject"
        tone="neutral"
        onConfirm={() => { setConfirmingReject(false); setStatus(item.id, "rejected").then(onChanged); }}
        onCancel={() => setConfirmingReject(false)}
      />
    </Drawer>
  );
}

function ListingsTab({
  pendingOnly,
  openRequest,
  onOpenRequestHandled,
}: {
  pendingOnly: boolean;
  openRequest?: { type: "centre" | "club"; id: string } | null;
  onOpenRequestHandled?: () => void;
}) {
  const [centres, setCentres] = useState<AdminListingSummary[]>([]);
  const [clubs, setClubs] = useState<AdminListingSummary[]>([]);
  const [organisations, setOrganisations] = useState<AdminOrganisation[]>([]);
  const [open, setOpen] = useState<{ type: "centre" | "club"; id: string } | null>(null);

  const load = () => {
    fetchAdminListings().then((data) => {
      const filter = (rows: AdminListingSummary[]) => (pendingOnly ? rows.filter((r) => r.status === "pending") : rows);
      setCentres(filter(data.centres));
      setClubs(filter(data.clubs));
    });
  };
  useEffect(() => { load(); }, [pendingOnly]);
  useEffect(() => { fetchAdminOrganisations().then(setOrganisations); }, []);
  useEffect(() => {
    if (openRequest) {
      setOpen(openRequest);
      onOpenRequestHandled?.();
    }
  }, [openRequest, onOpenRequestHandled]);

  const openItem = open ? (open.type === "centre" ? centres : clubs).find((c) => c.id === open.id) ?? null : null;
  const closeDrawer = () => setOpen(null);
  const onChanged = () => { load(); closeDrawer(); };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      <div>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 14px", letterSpacing: "-.01em" }}>Community centres</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {centres.map((c) => <ListingRow key={c.id} item={c} type="centre" onOpen={() => setOpen({ type: "centre", id: c.id })} onChanged={load} />)}
          {centres.length === 0 && (
            <EmptyState
              icon={<BadgedIcon icon={<BuildingIcon size={26} />} accent="green" />}
              title="Nothing waiting on you"
              subtitle={pendingOnly ? "All caught up! There are no community centres pending approval." : "No community centres yet."}
            />
          )}
        </div>
      </div>
      <div>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 14px", letterSpacing: "-.01em" }}>Sports clubs</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {clubs.map((c) => <ListingRow key={c.id} item={c} type="club" onOpen={() => setOpen({ type: "club", id: c.id })} onChanged={load} />)}
          {clubs.length === 0 && (
            <EmptyState
              icon={<BadgedIcon icon={<BallIcon size={26} />} accent="orange" />}
              title="Nothing waiting on you"
              subtitle={pendingOnly ? "All caught up! There are no sports clubs pending approval." : "No sports clubs yet."}
            />
          )}
        </div>
      </div>
      {open && (
        <ListingDrawer item={openItem} type={open.type} organisations={organisations} onChanged={onChanged} onClose={closeDrawer} />
      )}
    </div>
  );
}

function ReviewsTab() {
  const [reviews, setReviews] = useState<(Review & { hidden: number })[]>([]);
  const [confirmHideId, setConfirmHideId] = useState<number | null>(null);
  const load = () => fetchAdminReviews().then(setReviews);
  useEffect(() => { load(); }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      <div>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 14px", letterSpacing: "-.01em" }}>Reviews</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reviews.map((r) => (
            <Card key={r.id} hover style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 12 }}>
                <Avatar name={r.name} size={34} />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</span>
                    <StarDisplay rating={r.rating} />
                    <span style={{ fontSize: 11, color: colors.faint }}>{r.listingType} · {r.listingId}</span>
                    {!!r.hidden && <StatusBadge status="rejected" />}
                  </div>
                  {r.comment && <div style={{ fontSize: 13, color: "#3B423C", marginTop: 2 }}>{r.comment}</div>}
                </div>
              </div>
              {r.hidden ? (
                <Button variant="ghost" onClick={() => unhideReview(r.id).then(load)}>Unhide</Button>
              ) : (
                <Button variant="danger" onClick={() => setConfirmHideId(r.id)}>Hide</Button>
              )}
            </Card>
          ))}
          {reviews.length === 0 && <EmptyState icon={<StarIcon size={26} />} title="No reviews yet" />}
        </div>
      </div>
      <ReportsSection />
      <ConfirmDialog
        open={confirmHideId !== null}
        title="Hide this review?"
        message="It disappears from the public listing page immediately. You can unhide it again later from this tab."
        confirmLabel="Hide"
        onConfirm={() => { if (confirmHideId !== null) hideReview(confirmHideId).then(load); setConfirmHideId(null); }}
        onCancel={() => setConfirmHideId(null)}
      />
    </div>
  );
}

// --- reports queue (folded in from the former Platform Admin page — a
// separate user-submitted-flag queue that can target a review or a circle,
// distinct from directly hiding a review above) --------------------------

// Trust & Safety (IA spec §16) — each report expands into a case view
// (fetchReportCase) showing the resolved target + every other report ever
// filed against it, plus an investigation-notes field (saved independently
// of status) and a "Suspend" action that acts on the underlying target
// (closes a circle / hides a review), not just the report row.
function ReportsSection() {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [caseData, setCaseData] = useState<ReportCase | null>(null);
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState<{ id: number; status: "actioned" | "suspended" } | null>(null);

  const load = () => fetchModerationReports(showAll).then(setReports);
  useEffect(() => { load(); }, [showAll]);

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setCaseData(null);
      return;
    }
    setExpandedId(id);
    setCaseData(null);
    fetchReportCase(id).then((c) => {
      setCaseData(c);
      setNotes(c.report.adminNotes ?? "");
    });
  };

  const saveNotes = async (id: number) => {
    await resolveReport(id, { notes });
    load();
  };

  const resolve = async (id: number, status: "dismissed" | "actioned" | "suspended") => {
    await resolveReport(id, { status });
    setExpandedId(null);
    setCaseData(null);
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: 0, letterSpacing: "-.01em" }}>Reports</h3>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: colors.mutedLight, cursor: "pointer" }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show resolved
        </label>
      </div>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        User-submitted flags on reviews or circles. Expand a report to see the case — the resolved target, every
        related report against it, and investigation notes.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {reports.map((r) => (
          <Card key={r.id} style={{ padding: 15 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, cursor: "pointer" }} {...onActivateProps(() => toggleExpand(r.id))}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.targetType} · {r.targetId}</div>
                <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>{r.reason}</div>
                {r.status !== "pending" && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase" }}>{r.status}</span>
                )}
              </div>
              {/* Real Buttons below handle their own Enter/Space activation —
                  stop both click AND keydown from bubbling to the row's new
                  onKeyDown (added for keyboard access), or focusing one of
                  these and pressing Enter would also re-toggle the row. */}
              {r.status === "pending" && (
                <div style={{ display: "flex", gap: 8, flex: "none" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <Button variant="ghost" onClick={() => resolve(r.id, "dismissed")}>Dismiss</Button>
                  <Button variant="danger" onClick={() => setConfirming({ id: r.id, status: "suspended" })}>Suspend</Button>
                  <Button variant="danger" onClick={() => setConfirming({ id: r.id, status: "actioned" })}>Action</Button>
                </div>
              )}
            </div>
            {expandedId === r.id && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${colors.border}` }}>
                {!caseData ? (
                  <span style={{ fontSize: 12.5, color: colors.faint }}>Loading case…</span>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 6, textTransform: "uppercase" }}>Target</div>
                    {caseData.target ? (
                      <pre style={{ fontSize: 12, background: colors.panel, borderRadius: 8, padding: 10, overflowX: "auto", margin: "0 0 12px" }}>
                        {JSON.stringify(caseData.target, null, 2)}
                      </pre>
                    ) : (
                      <p style={{ fontSize: 12.5, color: colors.faint, margin: "0 0 12px" }}>Target no longer resolvable.</p>
                    )}
                    {caseData.relatedReports.length > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 6, textTransform: "uppercase" }}>
                          Related reports ({caseData.relatedReports.length})
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                          {caseData.relatedReports.map((rr) => (
                            <div key={rr.id} style={{ fontSize: 12.5, color: colors.mutedLight }}>
                              {rr.reason} — <span style={{ fontWeight: 700 }}>{rr.status}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <label style={labelStyle}>Investigation notes</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
                    <Button variant="ghost" onClick={() => saveNotes(r.id)}>Save notes</Button>
                  </>
                )}
              </div>
            )}
          </Card>
        ))}
        {reports.length === 0 && <EmptyState icon={<IdCardIcon size={26} />} title="Nothing pending" subtitle="No reports waiting on review." />}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.status === "suspended" ? "Suspend the reported content?" : "Action this report?"}
        message={
          confirming?.status === "suspended"
            ? "Closes the reported Circle, or hides the reported review, and marks the report suspended."
            : "Marks it as actioned and removes it from the queue. If you meant to hide the content itself, do that from the Reviews tab first."
        }
        confirmLabel={confirming?.status === "suspended" ? "Suspend" : "Action"}
        onConfirm={() => { if (confirming) resolve(confirming.id, confirming.status); setConfirming(null); }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

// --- audit log + system status (folded in from the former Platform Admin
// page — the only viewer for this session's writeAudit() calls across
// RBAC/org/listing actions) ------------------------------------------------

function StatusPanel() {
  const [status, setStatus] = useState<{ database: string; stripeConfigured: boolean; smtpConfigured: boolean } | null>(null);
  useEffect(() => { fetchSystemStatus().then(setStatus); }, []);
  if (!status) return <PageSpinner />;
  const rows: [string, boolean][] = [
    ["Database", status.database === "ok"],
    ["Stripe configured", status.stripeConfigured],
    ["Email (SMTP) configured", status.smtpConfigured],
  ];
  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        {rows.map(([label, ok]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
            {label}
            <span style={{ fontWeight: 700, fontSize: 12, padding: "2px 9px", borderRadius: radius.pill, color: ok ? colors.greenText : colors.orangeDark, background: ok ? colors.greenBg : colors.orangeBg }}>
              {ok ? "OK" : "Not configured"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => { fetchAuditLog().then(setEntries); }, []);
  return (
    <div className="fade-panel">
      <StatusPanel />
      {entries.length === 0 ? (
        <EmptyState icon={<ClipboardIcon size={26} />} title="No audit entries yet" subtitle="Actions taken from here on are logged." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>Object</th>
                <th style={thStyle}>Actor</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...tdStyle, color: colors.faint, whiteSpace: "nowrap" }}>{new Date(e.createdAt).toLocaleString()}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{e.action}</td>
                  <td style={tdStyle}>{e.objectType} <code>{e.objectId}</code></td>
                  <td style={tdStyle}>{e.actorEmail ?? "system"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- notification templates (implementation backlog #2) -------------------
// An override layer over notifications.ts's own hardcoded fallbacks — see
// notificationTemplates.ts's own comment for the exact scope (the 2 shared
// functions every booking/registration/experience/program path already
// calls, not every notification call site in the app). Leaving every field
// blank means every message stays exactly what it is today; a blank field
// on save clears back to that fallback (DELETE, not an empty-string row).

function NotificationTemplateCard({ t, onSaved }: { t: NotificationTemplateInfo; onSaved: () => void }) {
  const [subject, setSubject] = useState(t.subjectTemplate ?? "");
  const [title, setTitle] = useState(t.titleTemplate ?? "");
  const [body, setBody] = useState(t.bodyTemplate ?? "");
  const [saving, setSaving] = useState(false);
  const isOverridden = t.subjectTemplate !== null || t.titleTemplate !== null || t.bodyTemplate !== null;

  const save = async () => {
    setSaving(true);
    try {
      await setNotificationTemplate(t.key, {
        subjectTemplate: t.fields.includes("subject") ? subject || null : undefined,
        titleTemplate: t.fields.includes("title") ? title || null : undefined,
        bodyTemplate: t.fields.includes("body") ? body || null : undefined,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    await resetNotificationTemplate(t.key);
    setSubject("");
    setTitle("");
    setBody("");
    onSaved();
  };

  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{t.key}</div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>{t.description}</div>
        </div>
        {isOverridden && (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px", flex: "none" }}>Custom</span>
        )}
      </div>
      <p style={{ fontSize: 11.5, color: colors.faint, margin: "0 0 10px" }}>
        Placeholders: {t.vars.map((v) => `{{${v}}}`).join(", ")}. Leave a field blank to use the built-in default.
      </p>
      {t.fields.includes("subject") && (
        <>
          <label style={labelStyle}>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
        </>
      )}
      {t.fields.includes("title") && (
        <>
          <label style={labelStyle}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
        </>
      )}
      {t.fields.includes("body") && (
        <>
          <label style={labelStyle}>Body</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }} />
        </>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        {isOverridden && <Button variant="ghost" onClick={reset}>Reset to default</Button>}
      </div>
    </Card>
  );
}

function NotificationTemplatesTab() {
  const [templates, setTemplates] = useState<NotificationTemplateInfo[] | null>(null);

  const load = () => fetchNotificationTemplates().then(setTemplates);
  useEffect(() => { load(); }, []);

  if (!templates) return <PageSpinner />;

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <p style={{ fontSize: 13, color: colors.mutedLight, margin: 0, maxWidth: 640 }}>
        Covers the confirmation and cancellation emails sent for every booking, registration, experience booking and
        program enrollment — the highest-volume transactional messages in the app. Other notifications (waitlist
        offers, game updates, Circle activity) aren't covered here yet and stay as built-in copy.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {templates.map((t) => (
          <NotificationTemplateCard key={t.key} t={t} onSaved={load} />
        ))}
      </div>
    </div>
  );
}

// --- support search (folded in from the former Platform Admin page) -------

// Platform-wide booking/registration explorer (IA spec §16) — extended
// with games/circles and a default "recent activity" load (no query
// required), not just search-by-ref/email as before this pass.
function SupportTab() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ bookings: SupportBooking[]; registrations: SupportRegistration[]; users: SupportUser[]; games: SupportGame[]; circles: SupportCircle[] } | null>(null);
  const [overview, setOverview] = useState<{ openBookings: OpenBookingActivity[]; circleActivity: CircleActivity[] } | null>(null);

  useEffect(() => {
    supportSearch("").then(setResults);
    fetchActivityOverview().then(setOverview);
  }, []);

  const run = () => {
    supportSearch(q.trim()).then(setResults);
  };

  return (
    <div className="fade-panel">
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Booking/registration/session/circle ref or name, or an email address" style={inputStyle} />
        <Button onClick={run}><SearchIcon size={14} /> Search</Button>
      </div>

      {overview && (overview.openBookings.length > 0 || overview.circleActivity.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24, marginBottom: 24, paddingBottom: 24, borderBottom: `1px solid ${colors.border}` }}>
          <div>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase" }}>Open Bookings (most recent 50)</h4>
            {overview.openBookings.length === 0 ? (
              <span style={{ fontSize: 13, color: colors.faint }}>None yet.</span>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Session</th>
                      <th style={thStyle}>Booking</th>
                      <th style={thStyle}>Centre</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.openBookings.map((o) => (
                      <tr key={o.id}>
                        <td style={tdStyle}>{o.activityLabel} <span style={{ color: colors.faint }}>{o.date} {o.time}</span></td>
                        <td style={{ ...tdStyle, fontFamily: "monospace" }}>{o.bookingRefFull} <span style={{ color: colors.faint, fontFamily: fonts.body }}>({o.bookingName})</span></td>
                        <td style={tdStyle}>{o.centreName ?? "—"}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase" }}>Circle activity (most recent 50)</h4>
            {overview.circleActivity.length === 0 ? (
              <span style={{ fontSize: 13, color: colors.faint }}>None yet.</span>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Activity</th>
                      <th style={thStyle}>Members</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.circleActivity.map((c) => (
                      <tr key={c.id}>
                        <td style={tdStyle}>{c.name}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{c.activityLabel}</td>
                        <td style={tdStyle}>{c.memberCount}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {results && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase" }}>Bookings</h4>
            {results.bookings.length === 0 ? (
              <span style={{ fontSize: 13, color: colors.faint }}>No matches.</span>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Ref</th>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Date/Time</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.bookings.map((b) => (
                      <tr key={b.ref}>
                        <td style={{ ...tdStyle, fontFamily: "monospace" }}>{b.ref}</td>
                        <td style={tdStyle}>{b.name} <span style={{ color: colors.faint }}>({b.email})</span></td>
                        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{b.date} {b.time}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{b.status} · {b.paymentStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase" }}>Registrations</h4>
            {results.registrations.length === 0 ? (
              <span style={{ fontSize: 13, color: colors.faint }}>No matches.</span>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Ref</th>
                      <th style={thStyle}>Guardian</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.registrations.map((r) => (
                      <tr key={r.ref}>
                        <td style={{ ...tdStyle, fontFamily: "monospace" }}>{r.ref}</td>
                        <td style={tdStyle}>{r.gFirst} {r.gLast} <span style={{ color: colors.faint }}>({r.email})</span></td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{r.status} · {r.paymentStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase" }}>Users</h4>
            {results.users.length === 0 ? (
              <span style={{ fontSize: 13, color: colors.faint }}>No matches.</span>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Email</th>
                      <th style={thStyle}>Role</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.users.map((u) => (
                      <tr key={u.id}>
                        <td style={tdStyle}>{u.name || "—"}</td>
                        <td style={tdStyle}>{u.email}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{u.role}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{u.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase" }}>Sessions</h4>
            {results.games.length === 0 ? (
              <span style={{ fontSize: 13, color: colors.faint }}>No matches.</span>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Activity</th>
                      <th style={thStyle}>Date/Time</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Open Booking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.games.map((g) => (
                      <tr key={g.id}>
                        <td style={tdStyle}>{g.activityLabel}</td>
                        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{g.date} {g.time}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{g.status}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{g.bookingRef ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase" }}>Circles</h4>
            {results.circles.length === 0 ? (
              <span style={{ fontSize: 13, color: colors.faint }}>No matches.</span>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Activity</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.circles.map((c) => (
                      <tr key={c.id}>
                        <td style={tdStyle}>{c.name}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{c.activityLabel}</td>
                        <td style={{ ...tdStyle, color: colors.mutedLight }}>{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CouponsTab() {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [form, setForm] = useState({ code: "", kind: "percent" as "percent" | "fixed", amount: "", maxUses: "", expiresAt: "" });
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const load = () => fetchAdminCoupons().then(setCoupons);
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.code.trim() || !form.amount) return;
    setError(null);
    try {
      await createAdminCoupon({
        code: form.code.trim(),
        kind: form.kind,
        amount: Number(form.amount),
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        expiresAt: form.expiresAt || null,
      });
      setForm({ code: "", kind: "percent", amount: "", maxUses: "", expiresAt: "" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create that coupon");
    }
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>New coupon</h3>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.8fr 0.8fr 1fr 1.1fr auto", gap: 8, alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Code</label>
            <input placeholder="WELCOME10" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} style={{ ...inputStyle, textTransform: "uppercase" }} />
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as "percent" | "fixed" }))} style={inputStyle}>
              <option value="percent">% off</option>
              <option value="fixed">€ off</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Amount</label>
            <input type="number" placeholder={form.kind === "percent" ? "10" : "500"} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Max uses (optional)</label>
            <input type="number" placeholder="Unlimited" value={form.maxUses} onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Expires (optional)</label>
            <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} style={inputStyle} />
          </div>
          <Button onClick={create}>Create</Button>
        </div>
        <p style={{ fontSize: 12, color: colors.mutedLight, margin: "10px 0 0" }}>
          "€ off" amounts are in cents (e.g. 500 = €5.00). Applies to the pre-VAT/fee subtotal on any booking or registration.
        </p>
        {error && <p className="pop-in" style={{ color: colors.danger, fontSize: 13, margin: "12px 0 0", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>{error}</p>}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {coupons.map((c) => (
          <Card key={c.id} hover style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: colors.greenBg, color: colors.green, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <TagIcon size={16} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, fontFamily: "monospace" }}>{c.code}</span>
                  <StatusBadge status={c.active ? "approved" : "suspended"} />
                </div>
                <div style={{ fontSize: 12, color: colors.mutedLight }}>
                  {c.kind === "percent" ? `${c.amount}% off` : `€${(c.amount / 100).toFixed(2)} off`} · used {c.usedCount}
                  {c.maxUses ? `/${c.maxUses}` : ""} times{c.expiresAt ? ` · expires ${c.expiresAt}` : ""}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {c.active ? (
                <Button variant="ghost" onClick={() => setAdminCouponActive(c.id, false).then(load)}>Deactivate</Button>
              ) : (
                <Button variant="dark" onClick={() => setAdminCouponActive(c.id, true).then(load)}>Activate</Button>
              )}
              <Button variant="danger" onClick={() => setConfirmingId(c.id)}>Delete</Button>
            </div>
          </Card>
        ))}
        {coupons.length === 0 && <EmptyState icon={<TagIcon size={26} />} title="No coupons yet" subtitle="Create one above." />}
      </div>

      <ConfirmDialog
        open={confirmingId !== null}
        title="Delete this coupon?"
        message="This permanently deletes the coupon — it can't be undone. Consider Deactivate instead if you might want it again."
        confirmLabel="Delete"
        onConfirm={() => { if (confirmingId !== null) deleteAdminCoupon(confirmingId).then(load); setConfirmingId(null); }}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}

// --- organisations (Tier 4, best-effort scaffolding) — data-model only, no
// tenant isolation is enforced anywhere else in the app (every query
// remains platform-wide). Assignment happens per-listing in ListingRow
// above; this tab is just create/list. -------------------------------------

// Feature flags (implementation backlog #5) — real per-org capability
// toggles. Expands under a vendor-org card so an admin can turn Open
// Booking/Programs/Experiences on or off for that org specifically;
// server-enforced independently (see routes/bookings.ts, vendorPrograms.ts,
// vendorExperiences.ts), this is just where an admin actually flips them.
function OrgFlagsRow({ orgId }: { orgId: string }) {
  const [flags, setFlags] = useState<FeatureFlags | null>(null);

  useEffect(() => {
    fetchOrgFeatureFlags(orgId).then(setFlags);
  }, [orgId]);

  const toggle = async (key: FeatureFlagKey) => {
    if (!flags) return;
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    await setOrgFeatureFlag(orgId, key, next[key]);
  };

  if (!flags) return <span style={{ fontSize: 12, color: colors.faint }}>Loading flags…</span>;

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
      {FEATURE_FLAG_KEYS.map((key) => (
        <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={flags[key]} onChange={() => toggle(key)} style={{ accentColor: colors.green }} />
          {FEATURE_FLAG_LABELS[key]}
        </label>
      ))}
    </div>
  );
}

function OrganisationsTab({ onOpenVendor }: { onOpenVendor: (vendorId: string) => void }) {
  const [orgs, setOrgs] = useState<AdminOrganisation[]>([]);
  const [vendors, setVendors] = useState<AdminVendor[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("council");
  const [creating, setCreating] = useState(false);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);

  const load = () => fetchAdminOrganisations().then(setOrgs);
  useEffect(() => { load(); }, []);
  useEffect(() => { fetchAdminVendors().then(setVendors); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createAdminOrganisation({ name: name.trim(), kind });
      setName("");
      load();
    } finally {
      setCreating(false);
    }
  };

  // "Organisations" here has always meant two unrelated things sharing one
  // table: the org every vendor gets automatically at signup (kind:
  // 'vendor', real — it's what staff invites/RBAC hang off), and the
  // multi-tenant scaffolding an admin can hand-create (kind: anything else,
  // e.g. 'council') that admits its own assignment "has no effect on
  // visibility or access today." Splitting them so it's obvious which is
  // which, instead of listing them together as if they were the same kind
  // of thing.
  const vendorOrgs = orgs.filter((o) => o.kind === "vendor");
  const customOrgs = orgs.filter((o) => o.kind !== "vendor");

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      <div>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 6px", letterSpacing: "-.01em" }}>Vendor organisations</h3>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
          Created automatically for every vendor at signup — this is the real one, what staff invites and platform roles are scoped to. Read-only here; a vendor manages their own from their dashboard.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {vendorOrgs.map((o) => {
            const owner = vendors.find((v) => v.orgId === o.id && !v.invitedStaff);
            const memberCount = vendors.filter((v) => v.orgId === o.id).length;
            const expanded = expandedOrgId === o.id;
            return (
              <Card key={o.id} style={{ padding: 15 }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={() => setExpandedOrgId(expanded ? null : o.id)}
                >
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{o.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, color: colors.mutedLight }}>{memberCount} {memberCount === 1 ? "member" : "members"}</span>
                    {owner && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" onClick={() => onOpenVendor(owner.id)}>
                          View vendor
                        </Button>
                      </span>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: colors.faint, textTransform: "uppercase", marginBottom: 8 }}>Feature flags</div>
                    <OrgFlagsRow orgId={o.id} />
                  </div>
                )}
              </Card>
            );
          })}
          {vendorOrgs.length === 0 && <EmptyState icon={<UsersIcon size={26} />} title="No vendor organisations yet" />}
        </div>
      </div>

      <div>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 6px", letterSpacing: "-.01em" }}>Custom organisations</h3>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
          Scaffolding for a future multi-org deployment (e.g. a council overseeing several centres) — assigning a listing to one has no effect on visibility or access today.
        </p>
        <Card style={{ marginBottom: 16 }}>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14, margin: "0 0 12px" }}>New organisation</h4>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <label style={labelStyle}>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dublin City Council" style={inputStyle} />
            </div>
            <div style={{ flex: "0 0 160px" }}>
              <label style={labelStyle}>Kind</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
                <option value="council">Council</option>
                <option value="charity">Charity</option>
                <option value="school">School</option>
                <option value="private">Private</option>
              </select>
            </div>
            <Button onClick={create} disabled={creating || !name.trim()}>Create</Button>
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {customOrgs.map((o) => (
            <Card key={o.id} style={{ padding: 15, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{o.name}</span>
              <span style={{ fontSize: 12, color: colors.mutedLight, textTransform: "capitalize" }}>{o.kind}</span>
            </Card>
          ))}
          {customOrgs.length === 0 && <EmptyState icon={<BuildingIcon size={26} />} title="No custom organisations yet" subtitle="Create one above." />}
        </div>
      </div>
    </div>
  );
}

// --- demand intelligence, platform-wide (Tier 4) ---------------------------

function AdminDemandTab() {
  const [rows, setRows] = useState<DemandRow[] | null>(null);
  const [clusters, setClusters] = useState<IntentCluster[] | null>(null);
  useEffect(() => {
    fetchAdminDemand().then(setRows).catch(() => setRows([]));
    fetchAdminIntentClusters().then(setClusters).catch(() => setClusters([]));
  }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <IntentClusterView clusters={clusters} onNotify={notifyIntentCluster} />
      <DemandSignalsView
        title="Unmet demand, platform-wide"
        subtitle="Searches that returned nothing, aggregated across every vendor — useful for spotting a gap no one's listing yet."
        rows={rows}
      />
    </div>
  );
}

// --- marketplace health / liquidity (participation-intent plan Phase 2) ----

function AdminMarketplaceHealthTab() {
  const [data, setData] = useState<MarketplaceHealth | null>(null);
  const [referrals, setReferrals] = useState<ReferralAttributionRow[] | null>(null);
  const [funnel, setFunnel] = useState<AnalyticsFunnelRow[] | null>(null);
  useEffect(() => {
    fetchMarketplaceHealth().then(setData);
    fetchAdminReferrals().then(setReferrals).catch(() => setReferrals([]));
    fetchAnalyticsFunnel().then(setFunnel).catch(() => setFunnel([]));
  }, []);

  if (!data) return <PageSpinner />;
  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <MarketConfig />
      <MarketplaceHealthView data={data} referrals={referrals} funnel={funnel} />
    </div>
  );
}

type AdminTab = "overview" | "vendors" | "pending" | "listings" | "claims" | "hostApplications" | "placeSuggestions" | "reviews" | "coupons" | "organisations" | "demand" | "marketplaceHealth" | "audit" | "support" | "notificationTemplates" | "media";

const ADMIN_TABS: { key: AdminTab; label: string; icon: ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <EyeIcon size={15} /> },
  { key: "pending", label: "Pending approval", icon: <ClipboardIcon size={15} /> },
  { key: "vendors", label: "Vendors", icon: <UsersIcon size={15} /> },
  { key: "listings", label: "All listings", icon: <CalendarIcon size={15} /> },
  { key: "claims", label: "Claims", icon: <IdCardIcon size={15} /> },
  { key: "hostApplications", label: "Host applications", icon: <AwardIcon size={15} /> },
  { key: "placeSuggestions", label: "Place suggestions", icon: <PinIcon size={15} /> },
  { key: "reviews", label: "Reviews", icon: <StarIcon size={15} /> },
  { key: "coupons", label: "Coupons", icon: <TagIcon size={15} /> },
  { key: "organisations", label: "Organisations", icon: <BuildingIcon size={15} /> },
  { key: "demand", label: "Demand", icon: <TrendUpIcon size={15} /> },
  { key: "marketplaceHealth", label: "Marketplace health", icon: <GridIcon size={15} /> },
  { key: "audit", label: "Audit", icon: <ClipboardIcon size={15} /> },
  { key: "support", label: "Support", icon: <SearchIcon size={15} /> },
  { key: "notificationTemplates", label: "Notification templates", icon: <MailIcon size={15} /> },
  { key: "media", label: "Media", icon: <PhotoStackIcon size={15} /> },
];

// At-a-glance landing tab — the KPI row (moved here from the top-of-page
// header, which used to render it unconditionally on every tab) plus a
// small recent-activity panel reusing AuditTab's own fetch (no new
// backend call — just the last 5 entries instead of the full log).
function AdminOverviewTab({ stats }: { stats: AdminStats }) {
  const [recent, setRecent] = useState<AuditEntry[]>([]);
  const [recentError, setRecentError] = useState(false);
  useEffect(() => {
    fetchAuditLog()
      .then((rows) => setRecent(rows.slice(0, 5)))
      .catch(() => setRecentError(true));
  }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <KpiStrip
        marginBottom={0}
        hero={
          <KpiHero icon={<CalendarIcon size={19} />} value={stats.totalListings} label="Total listings" sublabel="All time" sublabelColor={colors.mutedLight} />
        }
      >
        <StatTile icon={<BuildingIcon size={19} />} value={stats.centresPending} label="Community centres" sublabel="Pending approval" sublabelColor={colors.greenText} />
        <StatTile icon={<BallIcon size={19} />} value={stats.clubsPending} label="Sports clubs" sublabel="Pending approval" sublabelColor={colors.orangeDark} />
        <StatTile icon={<UsersIcon size={19} />} value={stats.vendorCount} label="Vendors" sublabel="Registered" sublabelColor={colors.mutedLight} />
        <StatTile icon={<StarIcon size={19} />} value={stats.reviewCount} label="Reviews" sublabel="Total" sublabelColor={colors.mutedLight} />
        <StatTile icon={<CheckIcon size={19} />} value={stats.bookingsToday} label="Bookings today" sublabel="All types" sublabelColor={colors.mutedLight} />
        <StatTile icon={<IdCardIcon size={19} />} value={stats.paymentFailures} label="Payment failures" sublabel="All time" sublabelColor={colors.danger} />
        <StatTile icon={<ClipboardIcon size={19} />} value={stats.openReports} label="Open reports" sublabel="Awaiting action" sublabelColor={colors.danger} />
      </KpiStrip>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>Recent activity</h4>
        {recentError ? (
          <p style={{ fontSize: 13, color: colors.orangeDark }}>Couldn't load recent activity — try refreshing.</p>
        ) : recent.length === 0 ? (
          <EmptyState icon={<ClipboardIcon size={22} />} title="Nothing yet" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recent.map((e) => (
              <div key={e.id} style={{ fontSize: 13, background: colors.bg, borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
                <span><strong>{e.action}</strong> on {e.objectType} <code>{e.objectId}</code> by {e.actorEmail ?? "system"}</span>
                <span style={{ color: colors.faint, fontSize: 11.5 }}>{new Date(e.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function AdminDashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  // Lets VendorDrawer's listing links jump to the Listings tab with that
  // listing's own drawer already open, instead of just switching tabs.
  const [openListingRequest, setOpenListingRequest] = useState<{ type: "centre" | "club"; id: string } | null>(null);
  const [openVendorRequest, setOpenVendorRequest] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === "admin") fetchAdminStats().then(setStats);
  }, [user, tab]);

  // See VendorDashboard.tsx's identical comment — navigate() belongs in an
  // effect, not called directly during render.
  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) navigate("/login");
  }, [loading, user, navigate]);

  if (loading) return <PageSpinner />;
  if (!user || user.role !== "admin") return null;

  return (
    <ManageShell
      navTitle="Admin dashboard"
      navOptions={ADMIN_TABS}
      activeKey={tab}
      onNavChange={setTab}
      contextLabel="Admin"
      pageTitle={ADMIN_TABS.find((t) => t.key === tab)?.label}
      banner={
        tab === "overview" ? (
          <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 24, marginBottom: 32 }}>
            <DashboardTopPanel
              title={user.name}
              subtitle={`Admin dashboard · ${user.email}`}
              avatarName={user.name}
              accent="orange"
              eyebrow="/ Admin"
              tabs={ADMIN_TABS}
              activeTab={tab}
              onTabChange={setTab}
              bottomSpacing={0}
              hideTabs
              actions={
                stats &&
                (stats.centresPending + stats.clubsPending > 0 ? (
                  <Button variant="orange" onClick={() => setTab("pending")} style={{ padding: "10px 18px", fontSize: 13.5 }}>
                    Review {stats.centresPending + stats.clubsPending} pending approval{stats.centresPending + stats.clubsPending === 1 ? "" : "s"} →
                  </Button>
                ) : (
                  <span style={{ fontSize: 13, color: colors.mutedLight, fontWeight: 600 }}>All caught up</span>
                ))
              }
            />
          </div>
        ) : undefined
      }
    >
      {tab === "overview" && stats && <AdminOverviewTab stats={stats} />}
      {tab === "pending" && <ListingsTab pendingOnly />}
      {tab === "vendors" && (
        <VendorsTab
          onOpenListing={(type, id) => { setOpenListingRequest({ type, id }); setTab("listings"); }}
          openRequest={openVendorRequest}
          onOpenRequestHandled={() => setOpenVendorRequest(null)}
        />
      )}
      {tab === "listings" && (
        <ListingsTab pendingOnly={false} openRequest={openListingRequest} onOpenRequestHandled={() => setOpenListingRequest(null)} />
      )}
      {tab === "claims" && <ClaimsTab />}
      {tab === "hostApplications" && <HostApplicationsTab />}
      {tab === "placeSuggestions" && <PlaceSuggestionsTab />}
      {tab === "reviews" && <ReviewsTab />}
      {tab === "coupons" && <CouponsTab />}
      {tab === "organisations" && (
        <OrganisationsTab onOpenVendor={(vendorId) => { setOpenVendorRequest(vendorId); setTab("vendors"); }} />
      )}
      {tab === "demand" && <AdminDemandTab />}
      {tab === "marketplaceHealth" && <AdminMarketplaceHealthTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "support" && <SupportTab />}
      {tab === "notificationTemplates" && <NotificationTemplatesTab />}
      {tab === "media" && <AdminMediaTab />}
    </ManageShell>
  );
}
