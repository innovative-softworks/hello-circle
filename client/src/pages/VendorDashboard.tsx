import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createVendorBlock,
  createVendorCentre,
  createVendorClub,
  deleteVendorBlock,
  deleteVendorCentre,
  deleteVendorClub,
  fetchVendorBlocks,
  fetchVendorBookings,
  fetchVendorCentre,
  fetchVendorClub,
  fetchVendorListings,
  fetchVendorNotifications,
  fetchVendorRegistrations,
  fetchVendorStats,
  markVendorNotificationRead,
  updateVendorCentre,
  updateVendorClub,
  uploadImage,
  type CentreInput,
  type ClubInput,
} from "../api";
import { useAuth } from "../AuthContext";
import { VendorIllustration } from "../components/illustrations";
import {
  AwardIcon,
  BallIcon,
  BanIcon,
  BookmarkIcon,
  BuildingIcon,
  CalendarIcon,
  CameraIcon,
  ChatIcon,
  CheckCircleIcon,
  ClipboardIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  EyeIcon,
  PinIcon,
  PlusIcon,
  TrashIcon,
  TrendUpIcon,
} from "../components/icons";
import { Avatar, BadgedIcon, Button, Card, DashboardTopPanel, EmptyState, StatRow, StatTile, StatusBadge, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts, maxWidth } from "../theme";
import type { Centre, Club, MyBooking, MyRegistration, RoomBlock, VendorListingSummary, VendorNotification, VendorStats, VendorType } from "../types";

const HOUR_OPTIONS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];

function formatDate(iso: string): string {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

function MultiImageUpload({ images, onChange }: { images: string[]; onChange: (urls: string[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const { url } = await uploadImage(file);
        uploaded.push(url);
      }
      onChange([...images, ...uploaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeAt = (i: number) => onChange(images.filter((_, idx) => idx !== i));

  return (
    <div>
      <label style={labelStyle}>Photos</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
        {images.map((url, i) => (
          <div key={i} style={{ position: "relative", height: 90, borderRadius: 10, overflow: "hidden", background: colors.bg }}>
            <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <button
              onClick={() => removeAt(i)}
              aria-label="Remove photo"
              style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(20,22,20,.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <CloseIcon size={12} />
            </button>
            {i === 0 && (
              <span style={{ position: "absolute", left: 5, bottom: 5, background: "rgba(20,22,20,.7)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "2px 6px" }}>
                Cover
              </span>
            )}
          </div>
        ))}
        <label
          className="image-drop"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            height: 90,
            border: `1.5px dashed ${colors.borderStrong}`,
            borderRadius: 10,
            background: colors.bg,
            color: colors.mutedLight,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {uploading ? <CameraIcon size={18} /> : <PlusIcon size={18} />}
          {uploading ? "Uploading…" : "Add photo"}
          <input type="file" accept="image/*" multiple onChange={(e) => onFiles(e.target.files)} disabled={uploading} style={{ display: "none" }} />
        </label>
      </div>
      {error && <p style={{ color: "#b00020", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}

function centreToInput(c: Centre): CentreInput {
  return { name: c.name, area: c.area, county: c.county, capacity: c.capacity, from: c.from, managedBy: c.managedBy, image: c.image, images: c.images, blurb: c.blurb, amenities: c.amenities, opensAt: c.opensAt, closesAt: c.closesAt, paymentMethod: c.paymentMethod, isOpen: c.isOpen, mapUrl: c.mapUrl };
}
function blankCentreInput(): CentreInput {
  return { name: "", area: "", county: "", capacity: 0, from: 0, managedBy: "", image: "", images: [], blurb: "", amenities: [], opensAt: "09:00", closesAt: "21:00", paymentMethod: "online", isOpen: true, mapUrl: "" };
}
function clubToInput(c: Club): ClubInput {
  return { name: c.name, sport: c.sport, area: c.area, county: c.county, ages: c.ages, price: c.price, unit: c.unit, trial: c.trial, image: c.image, images: c.images, blurb: c.blurb, includes: c.includes, paymentMethod: c.paymentMethod, mapUrl: c.mapUrl };
}
function blankClubInput(): ClubInput {
  return { name: "", sport: "", area: "", county: "", ages: "", price: 0, unit: "year", trial: false, image: "", images: [], blurb: "", includes: [], paymentMethod: "online", mapUrl: "" };
}

// --- centre editor (fields + rooms) -----------------------------------------

function CentreEditor({ centreId, onClose, onSaved }: { centreId: string | "new"; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<CentreInput>(blankCentreInput());
  const [amenitiesText, setAmenitiesText] = useState("");
  const [centre, setCentre] = useState<Centre | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<RoomBlock[]>([]);
  const [blockForm, setBlockForm] = useState({ date: "", reason: "" });

  useEffect(() => {
    if (centreId !== "new") {
      fetchVendorCentre(centreId).then((c) => {
        setCentre(c);
        setForm(centreToInput(c));
        setAmenitiesText(c.amenities.join("\n"));
      });
      fetchVendorBlocks(centreId).then(setBlocks);
    }
  }, [centreId]);

  const set = <K extends keyof CentreInput>(k: K, v: CentreInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const amenities = amenitiesText.split("\n").map((s) => s.trim()).filter(Boolean);
      if (centreId === "new") {
        const created = await createVendorCentre({ ...form, amenities });
        setCentre(created);
        onSaved();
      } else {
        const updated = await updateVendorCentre(centreId, { ...form, amenities });
        setCentre(updated);
        onSaved();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const addBlock = async () => {
    if (!centre || !blockForm.date) return;
    await createVendorBlock(centre.id, { date: blockForm.date, reason: blockForm.reason });
    fetchVendorBlocks(centre.id).then(setBlocks);
    setBlockForm({ date: "", reason: "" });
  };

  const removeBlock = async (blockId: number) => {
    if (!centre) return;
    await deleteVendorBlock(centre.id, blockId);
    setBlocks((rows) => rows.filter((r) => r.id !== blockId));
  };

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: 0, letterSpacing: "-.01em" }}>
          {centreId === "new" ? "New community centre" : "Edit community centre"}
        </h3>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>

      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Managed by</label>
          <input value={form.managedBy} onChange={(e) => set("managedBy", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Area</label>
          <input value={form.area} onChange={(e) => set("area", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>County</label>
          <input value={form.county} onChange={(e) => set("county", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Capacity (guests)</label>
          <input type="number" value={form.capacity} onChange={(e) => set("capacity", Number(e.target.value))} placeholder="e.g. 100" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>From (€/hour)</label>
          <input type="number" value={form.from} onChange={(e) => set("from", Number(e.target.value))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Payment</label>
          <select value={form.paymentMethod ?? "online"} onChange={(e) => set("paymentMethod", e.target.value as "online" | "cash")} style={inputStyle}>
            <option value="online">Online payment</option>
            <option value="cash">Cash on arrival</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Opens at</label>
          <select value={form.opensAt ?? "09:00"} onChange={(e) => set("opensAt", e.target.value)} style={inputStyle}>
            {HOUR_OPTIONS.slice(0, -1).map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Closes at</label>
          <select value={form.closesAt ?? "21:00"} onChange={(e) => set("closesAt", e.target.value)} style={inputStyle}>
            {HOUR_OPTIONS.slice(1).map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Taking bookings?</label>
          <select value={form.isOpen === false ? "closed" : "open"} onChange={(e) => set("isOpen", e.target.value === "open")} style={inputStyle}>
            <option value="open">Open</option>
            <option value="closed">Closed (hide the Book button)</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Map link (optional)</label>
          <input value={form.mapUrl ?? ""} onChange={(e) => set("mapUrl", e.target.value)} placeholder="Google Maps link" style={inputStyle} />
        </div>
      </div>

      <label style={labelStyle}>Description</label>
      <textarea value={form.blurb} onChange={(e) => set("blurb", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <label style={labelStyle}>Amenities (one per line)</label>
      <textarea value={amenitiesText} onChange={(e) => setAmenitiesText(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <div style={{ marginBottom: 18 }}>
        <MultiImageUpload images={form.images ?? []} onChange={(images) => set("images", images)} />
      </div>

      {error && <p className="pop-in" style={{ color: "#b00020", fontSize: 13, margin: "0 0 12px", background: "#FBEAEA", padding: "9px 12px", borderRadius: 10 }}>{error}</p>}
      <Button disabled={saving || !form.name} onClick={save}>
        {centreId === "new" ? "Create (goes to admin for approval)" : "Save changes"}
      </Button>

      {centre && (
        <div style={{ marginTop: 26, borderTop: `1px solid ${colors.border}`, paddingTop: 20 }}>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Availability</h4>
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 12px" }}>
            Close a date (e.g. a festival) so guests can't book it.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {blocks.map((b) => (
              <div
                key={b.id}
                className="card-surface card-hover"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "10px 14px" }}
              >
                <div style={{ fontSize: 13 }}>
                  <strong>{formatDate(b.date)}</strong>
                  {b.reason && <> — {b.reason}</>}
                </div>
                <Button variant="danger" onClick={() => removeBlock(b.id)}>Delete</Button>
              </div>
            ))}
            {blocks.length === 0 && <EmptyState icon={<CalendarIcon size={26} />} title="Nothing blocked" subtitle="Every open date is bookable." />}
          </div>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr auto", gap: 8 }}>
            <input type="date" value={blockForm.date} onChange={(e) => setBlockForm((f) => ({ ...f, date: e.target.value }))} style={inputStyle} />
            <input placeholder="Reason (e.g. Festival)" value={blockForm.reason} onChange={(e) => setBlockForm((f) => ({ ...f, reason: e.target.value }))} style={inputStyle} />
            <Button variant="ghost" onClick={addBlock}>Block</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// --- club editor -------------------------------------------------------------

function ClubEditor({ clubId, onClose, onSaved }: { clubId: string | "new"; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ClubInput>(blankClubInput());
  const [includesText, setIncludesText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clubId !== "new") {
      fetchVendorClub(clubId).then((c) => {
        setForm(clubToInput(c));
        setIncludesText(c.includes.join("\n"));
      });
    }
  }, [clubId]);

  const set = <K extends keyof ClubInput>(k: K, v: ClubInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const includes = includesText.split("\n").map((s) => s.trim()).filter(Boolean);
      if (clubId === "new") await createVendorClub({ ...form, includes });
      else await updateVendorClub(clubId, { ...form, includes });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: 0, letterSpacing: "-.01em" }}>
          {clubId === "new" ? "New sports club" : "Edit sports club"}
        </h3>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>

      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Sport</label>
          <input value={form.sport} onChange={(e) => set("sport", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Area</label>
          <input value={form.area} onChange={(e) => set("area", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>County</label>
          <input value={form.county} onChange={(e) => set("county", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Ages (e.g. 5-16)</label>
          <input value={form.ages} onChange={(e) => set("ages", e.target.value)} style={inputStyle} />
        </div>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>Price (€)</label>
            <input type="number" value={form.price} onChange={(e) => set("price", Number(e.target.value))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Per</label>
            <select value={form.unit} onChange={(e) => set("unit", e.target.value)} style={inputStyle}>
              <option value="year">year</option>
              <option value="term">term</option>
              <option value="lesson">lesson</option>
              <option value="session">session</option>
            </select>
          </div>
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16, fontSize: 14, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 11, padding: "10px 13px", cursor: "pointer" }}>
        <input type="checkbox" checked={!!form.trial} onChange={(e) => set("trial", e.target.checked)} style={{ accentColor: colors.orange, width: 16, height: 16 }} />
        Offers a free trial session
      </label>

      <label style={labelStyle}>Registration payment</label>
      <select value={form.paymentMethod ?? "online"} onChange={(e) => set("paymentMethod", e.target.value as "online" | "cash")} style={{ ...inputStyle, marginBottom: 14 }}>
        <option value="online">Online payment</option>
        <option value="cash">Cash on arrival</option>
      </select>

      <label style={labelStyle}>Map link (optional)</label>
      <input value={form.mapUrl ?? ""} onChange={(e) => set("mapUrl", e.target.value)} placeholder="Google Maps link" style={{ ...inputStyle, marginBottom: 14 }} />

      <label style={labelStyle}>Description</label>
      <textarea value={form.blurb} onChange={(e) => set("blurb", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <label style={labelStyle}>What's included (one per line)</label>
      <textarea value={includesText} onChange={(e) => setIncludesText(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <div style={{ marginBottom: 18 }}>
        <MultiImageUpload images={form.images ?? []} onChange={(images) => set("images", images)} />
      </div>

      {error && <p className="pop-in" style={{ color: "#b00020", fontSize: 13, margin: "0 0 12px", background: "#FBEAEA", padding: "9px 12px", borderRadius: 10 }}>{error}</p>}
      <Button variant="orange" disabled={saving || !form.name} onClick={save}>
        {clubId === "new" ? "Create (goes to admin for approval)" : "Save changes"}
      </Button>
    </Card>
  );
}

// --- grow-your-presence hero panel -------------------------------------

function GrowPresencePanel({ onAddListing }: { onAddListing: () => void }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 20,
        alignItems: "center",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#fff", color: colors.green, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <TrendUpIcon size={19} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px", letterSpacing: "-.01em" }}>Grow your presence</h3>
          <p style={{ color: colors.muted, fontSize: 13, margin: "0 0 14px" }}>Add more centres and clubs to reach more families in your community.</p>
          <Button onClick={onAddListing}>+ Add new listing</Button>
        </div>
      </div>
      <div className="hide-mobile" style={{ width: 150, height: 90, flex: "none" }}>
        <VendorIllustration />
      </div>
    </div>
  );
}

// --- notifications tab (new bookings/registrations on the vendor's own listings) -

function MessagesTab({ onRead }: { onRead: () => void }) {
  const [notifications, setNotifications] = useState<VendorNotification[]>([]);

  useEffect(() => {
    fetchVendorNotifications().then(setNotifications);
  }, []);

  const markRead = (n: VendorNotification) => {
    if (n.read) return;
    markVendorNotificationRead(n.id).then(() => {
      setNotifications((rows) => rows.map((r) => (r.id === n.id ? { ...r, read: 1 } : r)));
      onRead();
    });
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {notifications.map((n) => (
        <Card
          key={n.id}
          hover
          onClick={() => markRead(n)}
          style={{ padding: 15, display: "flex", gap: 14, alignItems: "flex-start" }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: n.read ? colors.panel : colors.greenBg,
              color: n.read ? colors.muted : colors.green,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <ChatIcon size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{n.title}</span>
              {!n.read && <span style={{ width: 7, height: 7, borderRadius: "50%", background: colors.orange, flex: "none" }} />}
            </div>
            <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>{n.body}</div>
            <div style={{ fontSize: 11, color: colors.faint, marginTop: 4 }}>
              {formatDate(n.createdAt)} · Ref {n.ref}
            </div>
          </div>
        </Card>
      ))}
      {notifications.length === 0 && <EmptyState icon={<ChatIcon size={26} />} title="No notifications yet" subtitle="New bookings and registrations will show up here." />}
    </div>
  );
}

// --- bookings/registrations tab --------------------------------------------

function BookingsTab() {
  const [bookings, setBookings] = useState<(MyBooking & { name: string; email: string; phone: string })[]>([]);
  const [registrations, setRegistrations] = useState<(MyRegistration & { email: string; phone: string })[]>([]);

  useEffect(() => {
    fetchVendorBookings().then(setBookings);
    fetchVendorRegistrations().then(setRegistrations);
  }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Hall bookings</h4>
        {bookings.length === 0 && <EmptyState icon={<CalendarIcon size={26} />} title="No bookings yet" />}
        {bookings.map((b) => (
          <div key={b.ref} style={{ borderTop: `1px solid ${colors.border}`, padding: "12px 0", fontSize: 13, display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar name={b.name} size={28} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong>{b.centreName}</strong> · {b.date} {b.time} — {b.name} ({b.email}, {b.phone})
            </div>
          </div>
        ))}
      </Card>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Club registrations</h4>
        {registrations.length === 0 && <EmptyState icon={<AwardIcon size={26} />} title="No registrations yet" />}
        {registrations.map((r) => (
          <div key={r.ref} style={{ borderTop: `1px solid ${colors.border}`, padding: "12px 0", fontSize: 13, display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar name={`${r.childFirst} ${r.childLast}`} size={28} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong>{r.clubName}</strong> · {r.childFirst} {r.childLast} — {r.email}, {r.phone}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// --- setup checklist (scoped to the vendor's chosen type) ------------------

function ChecklistStep({ done, label }: { done: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: done ? colors.greenBg : colors.panel,
          color: done ? colors.green : colors.faint,
          border: done ? "none" : `1.5px solid ${colors.border}`,
        }}
      >
        {done && <CheckCircleIcon size={13} />}
      </div>
      <span style={{ fontSize: 13.5, color: done ? colors.text : colors.muted, textDecoration: done ? "line-through" : "none" }}>{label}</span>
    </div>
  );
}

function SetupChecklist({ vendorType, listings }: { vendorType: VendorType; listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] } }) {
  const rows = vendorType === "sports" ? listings.clubs.filter((c) => c.status !== "deleted") : listings.centres.filter((c) => c.status !== "deleted");
  const noun = vendorType === "sports" ? "sports club" : "community centre";
  const hasListing = rows.length > 0;
  const hasPhoto = rows.some((r) => !!r.image);
  const hasApproved = rows.some((r) => r.status === "approved");

  if (hasListing && hasPhoto && hasApproved) return null;

  return (
    <Card style={{ padding: "16px 20px", marginBottom: 24 }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Finish setting up</h3>
      <p style={{ color: colors.mutedLight, fontSize: 12.5, margin: "0 0 4px" }}>A few steps left before your {noun} is fully live.</p>
      <ChecklistStep done={hasListing} label={`Add your first ${noun}`} />
      <ChecklistStep done={hasPhoto} label="Add a photo" />
      <ChecklistStep done={hasApproved} label="Get admin approval for your listing" />
    </Card>
  );
}

// --- listings tab ------------------------------------------------------

function ListingsTab({
  vendorType,
  listings,
  onEditCentre,
  onEditClub,
  onNewCentre,
  onNewClub,
  reload,
}: {
  vendorType: VendorType | null;
  listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] };
  onEditCentre: (id: string) => void;
  onEditClub: (id: string) => void;
  onNewCentre: () => void;
  onNewClub: () => void;
  reload: () => void;
}) {
  const activeCentres = listings.centres.filter((c) => c.status !== "deleted");
  const activeClubs = listings.clubs.filter((c) => c.status !== "deleted");
  const showCentres = vendorType !== "sports";
  const showClubs = vendorType !== "community";

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      {vendorType && <SetupChecklist vendorType={vendorType} listings={listings} />}
      {showCentres && (
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: 0, letterSpacing: "-.01em" }}>Community centres</h3>
          <Button onClick={onNewCentre}>+ Add centre</Button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {activeCentres.map((c) => (
            <Card key={c.id} hover style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: colors.mutedLight }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><PinIcon size={12} />{c.area}, {c.county}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CalendarIcon size={12} />Listed on {formatDate(c.createdAt)}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: colors.greenBg, borderRadius: 10, padding: "6px 12px" }}>
                  <BookmarkIcon size={13} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{c.bookingsCount}</span>
                  <span style={{ fontSize: 11, color: colors.mutedLight }}>Bookings</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#E9F0FC", borderRadius: 10, padding: "6px 12px" }}>
                  <EyeIcon size={13} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{c.views}</span>
                  <span style={{ fontSize: 11, color: colors.mutedLight }}>Views</span>
                </div>
                <Button variant="ghost" onClick={() => onEditCentre(c.id)}><EditIcon size={14} /> {c.status === "approved" ? "Edit" : "Setup"}</Button>
                <Button variant="danger" onClick={() => deleteVendorCentre(c.id).then(reload)}><TrashIcon size={14} /> Delete</Button>
              </div>
            </Card>
          ))}
          {activeCentres.length === 0 && (
            <EmptyState icon={<BadgedIcon icon={<BuildingIcon size={26} />} accent="green" />} title="No community centres yet" subtitle="Click “Add centre” to list your first one." />
          )}
        </div>
      </div>
      )}

      {showClubs && (
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: 0, letterSpacing: "-.01em" }}>Sports clubs</h3>
          <Button variant="orange" onClick={onNewClub}>+ Add club</Button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {activeClubs.map((c) => (
            <Card key={c.id} hover style={{ padding: 15, display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: colors.mutedLight }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><PinIcon size={12} />{c.area}, {c.county}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CalendarIcon size={12} />Listed on {formatDate(c.createdAt)}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: colors.orangeBg, borderRadius: 10, padding: "6px 12px" }}>
                  <BookmarkIcon size={13} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{c.bookingsCount}</span>
                  <span style={{ fontSize: 11, color: colors.mutedLight }}>Registrations</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#E9F0FC", borderRadius: 10, padding: "6px 12px" }}>
                  <EyeIcon size={13} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{c.views}</span>
                  <span style={{ fontSize: 11, color: colors.mutedLight }}>Views</span>
                </div>
                <Button variant="ghost" onClick={() => onEditClub(c.id)}><EditIcon size={14} /> {c.status === "approved" ? "Edit" : "Setup"}</Button>
                <Button variant="danger" onClick={() => deleteVendorClub(c.id).then(reload)}><TrashIcon size={14} /> Delete</Button>
              </div>
            </Card>
          ))}
          {activeClubs.length === 0 && (
            <EmptyState icon={<BadgedIcon icon={<BallIcon size={26} />} accent="orange" />} title="No sports clubs yet" subtitle="Click “Add club” to list your first one." />
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// --- main dashboard ------------------------------------------------------

export function VendorDashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<"listings" | "messages" | "bookings">(initialTab === "bookings" || initialTab === "messages" ? initialTab : "listings");
  const [listings, setListings] = useState<{ centres: VendorListingSummary[]; clubs: VendorListingSummary[] }>({ centres: [], clubs: [] });
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [editingCentre, setEditingCentre] = useState<string | "new" | null>(null);
  const [editingClub, setEditingClub] = useState<string | "new" | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnreadCount = () => fetchVendorNotifications().then((rows) => setUnreadCount(rows.filter((r) => !r.read).length));

  const reload = () => {
    fetchVendorListings().then(setListings);
    fetchVendorStats().then(setStats);
    loadUnreadCount();
    setEditingCentre(null);
    setEditingClub(null);
  };

  useEffect(() => {
    if (user?.role === "vendor" && user.status === "approved") reload();
  }, [user]);

  if (loading) return null;
  if (!user || user.role !== "vendor") {
    navigate("/login");
    return null;
  }

  if (user.status !== "approved") {
    return (
      <div className="fade-panel">
        <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px" }}>
          <Card style={{ textAlign: "center", padding: 32 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, color: colors.muted }}>{user.status === "pending" ? <ClockIcon size={32} /> : <BanIcon size={32} />}</div>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, margin: "0 0 8px" }}>
              {user.status === "pending" ? "Awaiting approval" : "Account suspended"}
            </h2>
            <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.5 }}>
              {user.status === "pending"
                ? "An admin needs to approve your vendor account before you can create listings. Check back soon."
                : "Your vendor account has been suspended. Contact the site admin for details."}
            </p>
          </Card>
        </section>
      </div>
    );
  }

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "40px 24px 90px" }}>
        <div style={{ background: colors.greenBg, borderRadius: 22, padding: "28px 28px 24px", marginBottom: 32 }}>
          <div className="grid-responsive" style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "stretch", marginBottom: 24 }}>
            <div style={{ flex: "1 1 380px" }}>
              <DashboardTopPanel
                title={user.name}
                subtitle={`Vendor dashboard · ${user.email}`}
                avatarName={user.name}
                accent="green"
                tabs={[
                  { key: "listings", label: "Listings", icon: <ClipboardIcon size={15} /> },
                  { key: "messages", label: "Messages", icon: <ChatIcon size={15} /> },
                  { key: "bookings", label: "Bookings & registrations", icon: <CalendarIcon size={15} /> },
                ]}
                activeTab={tab}
                onTabChange={setTab}
                bottomSpacing={0}
              />
            </div>
            <div style={{ flex: "1 1 380px" }}>
              <GrowPresencePanel onAddListing={() => (user.vendorType === "sports" ? setEditingClub("new") : setEditingCentre("new"))} />
            </div>
          </div>

          {stats && (
            <StatRow marginBottom={0}>
              <StatTile icon={<BuildingIcon size={19} />} iconBg={colors.greenBg} iconColor={colors.green} value={stats.centresLive} label="Community centres" sublabel="Live listings" sublabelColor={colors.greenText} />
              <StatTile icon={<BallIcon size={19} />} iconBg={colors.orangeBg} iconColor={colors.orange} value={stats.clubsLive} label="Sports clubs" sublabel="Live listings" sublabelColor={colors.orangeDark} />
              <StatTile icon={<CalendarIcon size={19} />} iconBg="#E9F0FC" iconColor="#3B5FCC" value={stats.totalBookings} label="Total bookings" sublabel="All time" sublabelColor="#3B5FCC" />
              <StatTile icon={<EyeIcon size={19} />} iconBg="#F1E9FC" iconColor="#7B4FCC" value={stats.totalViews} label="Total views" sublabel="All time" sublabelColor="#7B4FCC" />
              <StatTile icon={<ChatIcon size={19} />} iconBg={colors.panel} iconColor={colors.muted} value={unreadCount} label="Unread messages" sublabel="From users" sublabelColor={colors.mutedLight} />
            </StatRow>
          )}
        </div>

        {tab === "listings" &&
          (editingCentre ? (
            <CentreEditor centreId={editingCentre} onClose={() => setEditingCentre(null)} onSaved={reload} />
          ) : editingClub ? (
            <ClubEditor clubId={editingClub} onClose={() => setEditingClub(null)} onSaved={reload} />
          ) : (
            <ListingsTab
              vendorType={user.vendorType}
              listings={listings}
              onEditCentre={setEditingCentre}
              onEditClub={setEditingClub}
              onNewCentre={() => setEditingCentre("new")}
              onNewClub={() => setEditingClub("new")}
              reload={reload}
            />
          ))}

        {tab === "messages" && <MessagesTab onRead={loadUnreadCount} />}
        {tab === "bookings" && <BookingsTab />}
      </section>
    </div>
  );
}
