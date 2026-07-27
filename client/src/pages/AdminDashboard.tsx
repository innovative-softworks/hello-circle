import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  adminDeleteCentre,
  adminDeleteClub,
  createAdminCoupon,
  deleteAdminCoupon,
  fetchAdminCoupons,
  fetchAdminListings,
  fetchAdminReviews,
  fetchAdminStats,
  fetchAdminVendors,
  hideReview,
  setAdminCouponActive,
  setCentreStatus,
  setClubStatus,
  setVendorStatus,
  unhideReview,
  type AdminCoupon,
  type AdminListingSummary,
  type AdminVendor,
} from "../api";
import { useAuth } from "../AuthContext";
import { AdminIllustration } from "../components/illustrations";
import { BallIcon, BuildingIcon, CalendarIcon, ClipboardIcon, PhoneIcon, PinIcon, StarIcon, TagIcon, UsersIcon } from "../components/icons";
import { Avatar, BadgedIcon, Button, Card, DashboardTopPanel, EmptyState, StarDisplay, StatRow, StatTile, StatusBadge, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts, maxWidth } from "../theme";
import type { AdminStats, Review } from "../types";

function VendorsTab() {
  const [vendors, setVendors] = useState<AdminVendor[]>([]);
  const load = () => fetchAdminVendors().then(setVendors);
  useEffect(() => { load(); }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {vendors.map((v) => (
        <Card key={v.id} hover style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
            <Avatar name={v.name} size={36} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{v.name}</span>
                <StatusBadge status={v.status} />
                {v.vendorType && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: 999,
                      background: v.vendorType === "sports" ? colors.orangeBg : colors.greenBg,
                      color: v.vendorType === "sports" ? colors.orangeDark : colors.greenText,
                    }}
                  >
                    {v.vendorType === "sports" ? <BallIcon size={11} /> : <BuildingIcon size={11} />}
                    {v.vendorType === "sports" ? "Sports club" : "Community"}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>{v.email} · {v.centreCount} centres · {v.clubCount} clubs</div>
              {v.businessName && (
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{v.businessName}</div>
              )}
              {(v.address || v.county || v.mobile || v.landline) && (
                <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>
                  {[v.address, v.county, v.mobile, v.landline && `${v.landline} (landline)`].filter(Boolean).join(" · ")}
                </div>
              )}
              {v.description && (
                <div style={{ fontSize: 12, color: colors.muted, marginTop: 6, maxWidth: 480 }}>{v.description}</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            {v.status !== "approved" && <Button variant="dark" onClick={() => setVendorStatus(v.id, "approved").then(load)}>Approve</Button>}
            {v.status !== "suspended" && <Button variant="ghost" onClick={() => setVendorStatus(v.id, "suspended").then(load)}>Suspend</Button>}
            {v.status === "suspended" && <Button variant="ghost" onClick={() => setVendorStatus(v.id, "approved").then(load)}>Reinstate</Button>}
          </div>
        </Card>
      ))}
      {vendors.length === 0 && <EmptyState icon={<UsersIcon size={26} />} title="No vendors yet" />}
    </div>
  );
}

function ListingRow({ item, type, onChanged }: { item: AdminListingSummary; type: "centre" | "club"; onChanged: () => void }) {
  const setStatus = type === "centre" ? setCentreStatus : setClubStatus;
  const del = type === "centre" ? adminDeleteCentre : adminDeleteClub;
  // A listing can't go live before its vendor's account has been vetted.
  // Grandfathered listings with no vendor (vendorStatus null) are exempt.
  const vendorNotApproved = !!item.vendorStatus && item.vendorStatus !== "approved";

  const facts = [
    [item.area, item.county].filter(Boolean).join(", "),
    item.ph,
    type === "centre"
      ? [item.capacity ? `cap ${item.capacity}` : null, item.from ? `from €${item.from}/hr` : null].filter(Boolean).join(" · ")
      : [item.sport, item.ages, item.price ? `€${item.price}/${item.unit}` : null].filter(Boolean).join(" · "),
  ].filter(Boolean);

  return (
    <Card hover style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", alignItems: "flex-start" }}>
      <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
        {item.image && (
          <img src={item.image} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", flex: "none" }} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</span>
            <StatusBadge status={item.status} />
          </div>
          {item.vendorEmail && (
            <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>
              {item.vendorName ? `${item.vendorName} · ` : ""}{item.vendorEmail}
            </div>
          )}
          {facts.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: colors.mutedLight, marginTop: 6 }}>
              {facts.map((f, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {i === 0 ? <PinIcon size={12} /> : i === 1 ? <PhoneIcon size={12} /> : null}
                  {f}
                </span>
              ))}
            </div>
          )}
          {item.blurb && (
            <div style={{ fontSize: 12, color: colors.muted, marginTop: 6, maxWidth: 480 }}>{item.blurb}</div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flex: "none" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {item.status !== "approved" && (
            <Button variant="dark" disabled={vendorNotApproved} onClick={() => setStatus(item.id, "approved").then(onChanged)}>
              Approve
            </Button>
          )}
          {item.status !== "rejected" && <Button variant="ghost" onClick={() => setStatus(item.id, "rejected").then(onChanged)}>Reject</Button>}
          <Button variant="danger" onClick={() => del(item.id).then(onChanged)}>Delete</Button>
        </div>
        {vendorNotApproved && (
          <span style={{ fontSize: 11, color: colors.orangeDark }}>Approve the vendor account first</span>
        )}
      </div>
    </Card>
  );
}

function ListingsTab({ pendingOnly }: { pendingOnly: boolean }) {
  const [centres, setCentres] = useState<AdminListingSummary[]>([]);
  const [clubs, setClubs] = useState<AdminListingSummary[]>([]);

  const load = () => {
    fetchAdminListings().then((data) => {
      const filter = (rows: AdminListingSummary[]) => (pendingOnly ? rows.filter((r) => r.status === "pending") : rows);
      setCentres(filter(data.centres));
      setClubs(filter(data.clubs));
    });
  };
  useEffect(() => { load(); }, [pendingOnly]);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      <div>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 14px", letterSpacing: "-.01em" }}>Community centres</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {centres.map((c) => <ListingRow key={c.id} item={c} type="centre" onChanged={load} />)}
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
          {clubs.map((c) => <ListingRow key={c.id} item={c} type="club" onChanged={load} />)}
          {clubs.length === 0 && (
            <EmptyState
              icon={<BadgedIcon icon={<BallIcon size={26} />} accent="orange" />}
              title="Nothing waiting on you"
              subtitle={pendingOnly ? "All caught up! There are no sports clubs pending approval." : "No sports clubs yet."}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AdminHeroPanel() {
  return (
    <div style={{ position: "relative", overflow: "hidden", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", top: -22, right: 8, width: 130, height: 130, borderRadius: "50%", background: "rgba(232,98,42,.14)" }} />
      <div style={{ position: "absolute", bottom: -28, left: 10, width: 115, height: 115, borderRadius: "50%", background: "rgba(232,98,42,.14)" }} />
      <div className="hide-mobile" style={{ position: "relative", width: 220, height: 130 }}>
        <AdminIllustration />
      </div>
    </div>
  );
}

function ReviewsTab() {
  const [reviews, setReviews] = useState<(Review & { hidden: number })[]>([]);
  const load = () => fetchAdminReviews().then(setReviews);
  useEffect(() => { load(); }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
            <Button variant="danger" onClick={() => hideReview(r.id).then(load)}>Hide</Button>
          )}
        </Card>
      ))}
      {reviews.length === 0 && <EmptyState icon={<StarIcon size={26} />} title="No reviews yet" />}
    </div>
  );
}

function CouponsTab() {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [form, setForm] = useState({ code: "", kind: "percent" as "percent" | "fixed", amount: "", maxUses: "", expiresAt: "" });
  const [error, setError] = useState<string | null>(null);
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
        {error && <p className="pop-in" style={{ color: "#b00020", fontSize: 13, margin: "12px 0 0", background: "#FBEAEA", padding: "9px 12px", borderRadius: 10 }}>{error}</p>}
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
              <Button variant="danger" onClick={() => deleteAdminCoupon(c.id).then(load)}>Delete</Button>
            </div>
          </Card>
        ))}
        {coupons.length === 0 && <EmptyState icon={<TagIcon size={26} />} title="No coupons yet" subtitle="Create one above." />}
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"vendors" | "pending" | "listings" | "reviews" | "coupons">("pending");
  const [stats, setStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    if (user?.role === "admin") fetchAdminStats().then(setStats);
  }, [user, tab]);

  if (loading) return null;
  if (!user || user.role !== "admin") {
    navigate("/login");
    return null;
  }

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "40px 24px 90px" }}>
        <div style={{ background: "#FBF0E9", borderRadius: 22, padding: "28px 28px 24px", marginBottom: 32 }}>
          <div className="grid-responsive" style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "stretch", marginBottom: 24 }}>
            <div style={{ flex: "1 1 380px" }}>
              <DashboardTopPanel
                title={user.name}
                subtitle={`Admin dashboard · ${user.email}`}
                avatarName={user.name}
                accent="orange"
                tabs={[
                  { key: "pending", label: "Pending approval", icon: <ClipboardIcon size={15} /> },
                  { key: "vendors", label: "Vendors", icon: <UsersIcon size={15} /> },
                  { key: "listings", label: "All listings", icon: <CalendarIcon size={15} /> },
                  { key: "reviews", label: "Reviews", icon: <StarIcon size={15} /> },
                  { key: "coupons", label: "Coupons", icon: <TagIcon size={15} /> },
                ]}
                activeTab={tab}
                onTabChange={setTab}
                bottomSpacing={0}
              />
            </div>
            <div style={{ flex: "1 1 380px" }}>
              <AdminHeroPanel />
            </div>
          </div>

          {stats && (
            <StatRow marginBottom={0}>
              <StatTile icon={<BuildingIcon size={19} />} iconBg={colors.greenBg} iconColor={colors.green} value={stats.centresPending} label="Community centres" sublabel="Pending approval" sublabelColor={colors.greenText} />
              <StatTile icon={<BallIcon size={19} />} iconBg={colors.orangeBg} iconColor={colors.orange} value={stats.clubsPending} label="Sports clubs" sublabel="Pending approval" sublabelColor={colors.orangeDark} />
              <StatTile icon={<UsersIcon size={19} />} iconBg="#F1E9FC" iconColor="#7B4FCC" value={stats.vendorCount} label="Vendors" sublabel="Registered" sublabelColor="#7B4FCC" />
              <StatTile icon={<CalendarIcon size={19} />} iconBg="#E9F0FC" iconColor="#3B5FCC" value={stats.totalListings} label="Total listings" sublabel="All time" sublabelColor="#3B5FCC" />
              <StatTile icon={<StarIcon size={19} />} iconBg="#FCF3D9" iconColor="#B8860B" value={stats.reviewCount} label="Reviews" sublabel="Total" sublabelColor="#B8860B" />
            </StatRow>
          )}
        </div>

        {tab === "pending" && <ListingsTab pendingOnly />}
        {tab === "vendors" && <VendorsTab />}
        {tab === "listings" && <ListingsTab pendingOnly={false} />}
        {tab === "reviews" && <ReviewsTab />}
        {tab === "coupons" && <CouponsTab />}
      </section>
    </div>
  );
}
