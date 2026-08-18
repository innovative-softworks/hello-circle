import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  checkInBooking,
  createClubSession,
  createVendorBlock,
  createVendorCentre,
  createVendorClub,
  createVendorRoom,
  deleteClubSession,
  deleteVendorBlock,
  deleteVendorCentre,
  deleteVendorClub,
  fetchCentreHours,
  fetchClubSessions,
  fetchVendorBlocks,
  fetchVendorBookings,
  fetchVendorCentre,
  fetchVendorClub,
  fetchVendorClubWaitlist,
  fetchVendorDemand,
  fetchVendorListings,
  fetchVendorMessages,
  fetchVendorNotifications,
  fetchVendorRegistrations,
  fetchVendorRooms,
  fetchVendorStats,
  fetchVendorToday,
  markVendorNotificationRead,
  saveCentreHours,
  sendVendorMessage,
  updateVendorCentre,
  updateVendorClub,
  updateVendorRoom,
  uploadImage,
  type CentreInput,
  type ClubInput,
} from "../api";
import { useAuth } from "../AuthContext";
import { useDashboardNav } from "../DashboardNavContext";
import { CommunityIllustration } from "../components/illustrations";
import {
  AwardIcon,
  BallIcon,
  BanIcon,
  BuildingIcon,
  CalendarIcon,
  CameraIcon,
  ChatIcon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  EyeIcon,
  LightbulbIcon,
  PinIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  TrendUpIcon,
  UsersIcon,
} from "../components/icons";
import { Avatar, Button, Card, ConfirmDialog, DashboardTopPanel, Drawer, EmptyState, LinkButton, NavSidebar, PageSpinner, StatRow, StatTile, StatusBadge, inputStyle, labelStyle, tableStyle, tdStyle, thStyle } from "../components/ui";
import { ACTIVITY_CATEGORIES } from "../constants";
import { DemandSignalsView } from "../components/DemandSignals";
import { VendorOrgTab } from "../components/VendorOrg";
import { VendorProgramsTab, VendorScheduleTab } from "../components/VendorPrograms";
import { colors, fonts, maxWidth } from "../theme";
import type {
  Centre,
  Club,
  ClubSession,
  DemandRow,
  MyBooking,
  MyRegistration,
  Room,
  RoomBlock,
  VendorListingSummary,
  VendorNotification,
  VendorStats,
  VendorToday,
  VendorType,
  WaitlistEntry,
} from "../types";

const HOUR_OPTIONS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];

// `iso` is already a full ISO 8601 UTC timestamp from the server — just
// needs Ireland-timezone display formatting, not further tz massaging.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

function formatMemberSince(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "Europe/Dublin" });
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
  return { name: c.name, area: c.area, county: c.county, managedBy: c.managedBy, image: c.image, images: c.images, blurb: c.blurb, amenities: c.amenities, opensAt: c.opensAt, closesAt: c.closesAt, isOpen: c.isOpen, mapUrl: c.mapUrl, phone: c.phone, accessibility: c.accessibility };
}
function blankCentreInput(): CentreInput {
  return { name: "", area: "", county: "", managedBy: "", image: "", images: [], blurb: "", amenities: [], opensAt: "09:00", closesAt: "21:00", isOpen: true, mapUrl: "", phone: "", accessibility: [] };
}
function clubToInput(c: Club): ClubInput {
  return { name: c.name, sport: c.sport, area: c.area, county: c.county, ages: c.ages, price: c.price, unit: c.unit, trial: c.trial, image: c.image, images: c.images, blurb: c.blurb, includes: c.includes, paymentMethod: c.paymentMethod, mapUrl: c.mapUrl, capacity: c.capacity, phone: c.phone, accessibility: c.accessibility, category: c.category };
}
function blankClubInput(): ClubInput {
  return { name: "", sport: "", area: "", county: "", ages: "", price: 0, unit: "year", trial: false, image: "", images: [], blurb: "", includes: [], paymentMethod: "online", mapUrl: "", capacity: null, phone: "", accessibility: [], category: "" };
}

// --- centre editor (fields + rooms) -----------------------------------------

function CentreEditor({ centreId, onSaved }: { centreId: string | "new"; onSaved: () => void }) {
  const [form, setForm] = useState<CentreInput>(blankCentreInput());
  const [amenitiesText, setAmenitiesText] = useState("");
  const [accessibilityText, setAccessibilityText] = useState("");
  const [centre, setCentre] = useState<Centre | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<RoomBlock[]>([]);
  const [blockForm, setBlockForm] = useState({ date: "", reason: "", roomId: "" });
  const [confirmingBlockId, setConfirmingBlockId] = useState<number | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  const reloadRooms = () => {
    if (centreId !== "new") fetchVendorRooms(centreId).then(setRooms);
  };

  useEffect(() => {
    if (centreId !== "new") {
      fetchVendorCentre(centreId).then((c) => {
        setCentre(c);
        setForm(centreToInput(c));
        setAmenitiesText(c.amenities.join("\n"));
        setAccessibilityText(c.accessibility.join("\n"));
      });
      fetchVendorBlocks(centreId).then(setBlocks);
      reloadRooms();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreId]);

  const set = <K extends keyof CentreInput>(k: K, v: CentreInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const amenities = amenitiesText.split("\n").map((s) => s.trim()).filter(Boolean);
      const accessibility = accessibilityText.split("\n").map((s) => s.trim()).filter(Boolean);
      if (centreId === "new") {
        const created = await createVendorCentre({ ...form, amenities, accessibility });
        setCentre(created);
        onSaved();
      } else {
        const updated = await updateVendorCentre(centreId, { ...form, amenities, accessibility });
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
    setBlockError(null);
    if (!centre) return;
    if (!blockForm.date) {
      setBlockError("Pick a date first");
      return;
    }
    try {
      await createVendorBlock(centre.id, { date: blockForm.date, reason: blockForm.reason, roomId: blockForm.roomId || undefined });
    } catch (e) {
      setBlockError(e instanceof Error ? e.message : "Couldn't add that block");
      return;
    }
    fetchVendorBlocks(centre.id).then(setBlocks);
    setBlockForm({ date: "", reason: "", roomId: "" });
  };

  const removeBlock = async (blockId: number) => {
    if (!centre) return;
    await deleteVendorBlock(centre.id, blockId);
    setBlocks((rows) => rows.filter((r) => r.id !== blockId));
    setConfirmingBlockId(null);
  };

  return (
    <>
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
        <div>
          <label style={labelStyle}>Contact phone (optional)</label>
          <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. 01 234 5678" style={inputStyle} />
        </div>
      </div>

      <label style={labelStyle}>Description</label>
      <textarea value={form.blurb} onChange={(e) => set("blurb", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <label style={labelStyle}>Amenities (one per line)</label>
      <textarea value={amenitiesText} onChange={(e) => setAmenitiesText(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <label style={labelStyle}>Accessibility (one per line, e.g. "Wheelchair accessible entrance")</label>
      <textarea value={accessibilityText} onChange={(e) => setAccessibilityText(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <div style={{ marginBottom: 18 }}>
        <MultiImageUpload images={form.images ?? []} onChange={(images) => set("images", images)} />
      </div>

      {error && <p className="pop-in" style={{ color: "#b00020", fontSize: 13, margin: "0 0 12px", background: "#FBEAEA", padding: "9px 12px", borderRadius: 10 }}>{error}</p>}
      <Button disabled={saving || !form.name} onClick={save}>
        {centreId === "new" ? "Create (goes to admin for approval)" : "Save changes"}
      </Button>

      {centre && <RoomsManager centreId={centre.id} rooms={rooms} onChanged={reloadRooms} />}

      {centre && (
        <div style={{ marginTop: 26, borderTop: `1px solid ${colors.border}`, paddingTop: 20 }}>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Availability</h4>
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 12px" }}>
            Close a date (e.g. a festival) so guests can't book it — for one room, or the whole centre.
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
                  {" — "}
                  {b.roomId ? rooms.find((r) => r.id === b.roomId)?.name ?? "a room" : "Whole centre"}
                  {b.reason && <> · {b.reason}</>}
                </div>
                <Button variant="danger" onClick={() => setConfirmingBlockId(b.id)}>Delete</Button>
              </div>
            ))}
            {blocks.length === 0 && <EmptyState icon={<CalendarIcon size={26} />} title="Nothing blocked" subtitle="Every open date is bookable." />}
          </div>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.3fr auto", gap: 8 }}>
            <input type="date" value={blockForm.date} onChange={(e) => setBlockForm((f) => ({ ...f, date: e.target.value }))} style={inputStyle} />
            <select value={blockForm.roomId} onChange={(e) => setBlockForm((f) => ({ ...f, roomId: e.target.value }))} style={inputStyle}>
              <option value="">Whole centre</option>
              {rooms.filter((r) => r.active).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <input placeholder="Reason (e.g. Festival)" value={blockForm.reason} onChange={(e) => setBlockForm((f) => ({ ...f, reason: e.target.value }))} style={inputStyle} />
            <Button variant="ghost" onClick={addBlock}>Block</Button>
          </div>
          {blockError && <p className="pop-in" style={{ color: "#b00020", fontSize: 13, margin: "10px 0 0", background: "#FBEAEA", padding: "9px 12px", borderRadius: 10 }}>{blockError}</p>}
          <FacilityHoursEditor centreId={centre.id} />
        </div>
      )}

      <ConfirmDialog
        open={confirmingBlockId !== null}
        title="Remove this block?"
        message="That date becomes bookable again. This is just a calendar block, not a real booking — nothing else is affected."
        confirmLabel="Remove"
        onConfirm={() => confirmingBlockId !== null && removeBlock(confirmingBlockId)}
        onCancel={() => setConfirmingBlockId(null)}
      />
    </>
  );
}

// --- rooms (independently bookable spaces within a centre) -----------------

function RoomsManager({ centreId, rooms, onChanged }: { centreId: string; rooms: Room[]; onChanged: () => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", cap: "", rate: "", paymentMethod: "online" as "online" | "cash" });
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", cap: "", rate: "", paymentMethod: "online" as "online" | "cash" });
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState<Room | null>(null);

  const add = async () => {
    if (!form.name) return;
    setAdding(true);
    setError(null);
    try {
      await createVendorRoom(centreId, { name: form.name, cap: Number(form.cap) || 0, rate: Number(form.rate) || 0, paymentMethod: form.paymentMethod });
      setForm({ name: "", cap: "", rate: "", paymentMethod: "online" });
      setAddOpen(false);
      onChanged();
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (r: Room) => {
    setEditingId(r.id);
    setEditForm({ name: r.name, cap: String(r.cap), rate: String(r.rate), paymentMethod: r.paymentMethod });
  };

  const saveEdit = async (roomId: string) => {
    await updateVendorRoom(centreId, roomId, {
      name: editForm.name,
      cap: Number(editForm.cap) || 0,
      rate: Number(editForm.rate) || 0,
      paymentMethod: editForm.paymentMethod,
    });
    setEditingId(null);
    onChanged();
  };

  const toggleActive = async (r: Room) => {
    setError(null);
    try {
      await updateVendorRoom(centreId, r.id, { active: !r.active });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update this room");
    } finally {
      setConfirmingDeactivate(null);
    }
  };

  const handleToggleClick = (r: Room) => {
    if (r.active) setConfirmingDeactivate(r);
    else toggleActive(r);
  };

  return (
    <div style={{ marginTop: 26, borderTop: `1px solid ${colors.border}`, paddingTop: 20 }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Rooms</h4>
      <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 12px" }}>
        Guests pick one of these when booking. Each has its own capacity, rate and payment method.
      </p>

      {error && <p className="pop-in" style={{ color: "#b00020", fontSize: 13, margin: "0 0 12px", background: "#FBEAEA", padding: "9px 12px", borderRadius: 10 }}>{error}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {rooms.map((r) =>
          editingId === r.id ? (
            <div key={r.id} className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.3fr .8fr .8fr 1fr auto auto", gap: 8, alignItems: "center", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "10px 14px" }}>
              <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} style={inputStyle} />
              <input type="number" value={editForm.cap} onChange={(e) => setEditForm((f) => ({ ...f, cap: e.target.value }))} placeholder="Capacity" style={inputStyle} />
              <input type="number" value={editForm.rate} onChange={(e) => setEditForm((f) => ({ ...f, rate: e.target.value }))} placeholder="€/hour" style={inputStyle} />
              <select value={editForm.paymentMethod} onChange={(e) => setEditForm((f) => ({ ...f, paymentMethod: e.target.value as "online" | "cash" }))} style={inputStyle}>
                <option value="online">Online payment</option>
                <option value="cash">Cash on arrival</option>
              </select>
              <Button onClick={() => saveEdit(r.id)}>Save</Button>
              <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
            </div>
          ) : (
            <div
              key={r.id}
              className="card-surface card-hover"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "10px 14px", opacity: r.active ? 1 : 0.5 }}
            >
              <div style={{ fontSize: 13 }}>
                <strong>{r.name}</strong> — cap {r.cap} · €{r.rate}/hr · {r.paymentMethod === "cash" ? "Cash on arrival" : "Online payment"}
                {!r.active && " · Inactive"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="ghost" onClick={() => startEdit(r)}>Edit</Button>
                <Button variant={r.active ? "danger" : "ghost"} onClick={() => handleToggleClick(r)}>{r.active ? "Deactivate" : "Reactivate"}</Button>
              </div>
            </div>
          )
        )}
        {rooms.length === 0 && <EmptyState icon={<CalendarIcon size={26} />} title="No rooms yet" subtitle="Add one below." />}
      </div>

      {addOpen ? (
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.3fr .8fr .8fr 1fr auto auto", gap: 8 }}>
          <input placeholder="Room name (e.g. Main Hall)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={inputStyle} />
          <input placeholder="Capacity" type="number" value={form.cap} onChange={(e) => setForm((f) => ({ ...f, cap: e.target.value }))} style={inputStyle} />
          <input placeholder="€/hour" type="number" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} style={inputStyle} />
          <select value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as "online" | "cash" }))} style={inputStyle}>
            <option value="online">Online payment</option>
            <option value="cash">Cash on arrival</option>
          </select>
          <Button variant="ghost" onClick={add} disabled={adding || !form.name}>
            <PlusIcon size={14} /> Add
          </Button>
          <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setAddOpen(true)}>
          <PlusIcon size={14} /> Add room
        </Button>
      )}

      <ConfirmDialog
        open={!!confirmingDeactivate}
        title={`Deactivate ${confirmingDeactivate?.name ?? "this room"}?`}
        message="Guests won't be able to book it anymore. You can reactivate it any time — nothing is deleted."
        confirmLabel="Deactivate"
        onConfirm={() => confirmingDeactivate && toggleActive(confirmingDeactivate)}
        onCancel={() => setConfirmingDeactivate(null)}
      />
    </div>
  );
}

// --- per-day opening hours (Phase B) — optional; falls back to the single
// opens_at/closes_at window above when no rows are saved. --------------

function FacilityHoursEditor({ centreId }: { centreId: string }) {
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const [days, setDays] = useState<{ dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCentreHours(centreId).then((rows) => {
      if (rows.length > 0) setDays(rows);
    });
  }, [centreId]);

  const ensureAllDays = () => {
    if (days.length === 7) return days;
    const filled = DAY_NAMES.map((_, i) => days.find((d) => d.dayOfWeek === i) ?? { dayOfWeek: i, opensAt: "09:00", closesAt: "21:00", closed: false });
    setDays(filled);
    return filled;
  };

  const update = (dayOfWeek: number, patch: Partial<{ opensAt: string; closesAt: string; closed: boolean }>) => {
    const base = days.length === 7 ? days : ensureAllDays();
    setDays(base.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveCentreHours(centreId, days.length === 7 ? days : ensureAllDays());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 26, borderTop: `1px solid ${colors.border}`, paddingTop: 20 }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Per-day hours (optional)</h4>
      <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 12px" }}>
        Leave unset to keep using the single opening-hours window above for every day.
      </p>
      {days.length === 0 ? (
        <Button variant="ghost" onClick={ensureAllDays}>Set per-day hours</Button>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {DAY_NAMES.map((name, i) => {
              const d = days.find((x) => x.dayOfWeek === i) ?? { dayOfWeek: i, opensAt: "09:00", closesAt: "21:00", closed: false };
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                  <span style={{ width: 90, flex: "none" }}>{name}</span>
                  <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <input type="checkbox" checked={!d.closed} onChange={(e) => update(i, { closed: !e.target.checked })} style={{ accentColor: colors.green }} /> Open
                  </label>
                  {!d.closed && (
                    <>
                      <input type="time" value={d.opensAt} onChange={(e) => update(i, { opensAt: e.target.value })} style={{ ...inputStyle, width: 100, padding: "6px 8px" }} />
                      <span>–</span>
                      <input type="time" value={d.closesAt} onChange={(e) => update(i, { closesAt: e.target.value })} style={{ ...inputStyle, width: 100, padding: "6px 8px" }} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <Button variant="ghost" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save hours"}
          </Button>
        </>
      )}
    </div>
  );
}

// --- club editor -------------------------------------------------------------

function ClubEditor({ clubId, onSaved }: { clubId: string | "new"; onSaved: () => void }) {
  const [form, setForm] = useState<ClubInput>(blankClubInput());
  const [includesText, setIncludesText] = useState("");
  const [accessibilityText, setAccessibilityText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clubId !== "new") {
      fetchVendorClub(clubId).then((c) => {
        setForm(clubToInput(c));
        setIncludesText(c.includes.join("\n"));
        setAccessibilityText(c.accessibility.join("\n"));
      });
    }
  }, [clubId]);

  const set = <K extends keyof ClubInput>(k: K, v: ClubInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const includes = includesText.split("\n").map((s) => s.trim()).filter(Boolean);
      const accessibility = accessibilityText.split("\n").map((s) => s.trim()).filter(Boolean);
      if (clubId === "new") await createVendorClub({ ...form, includes, accessibility });
      else await updateVendorClub(clubId, { ...form, includes, accessibility });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
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
          <label style={labelStyle}>Category</label>
          <select value={form.category ?? ""} onChange={(e) => set("category", e.target.value)} style={inputStyle}>
            <option value="">— none —</option>
            {ACTIVITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
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

      <label style={labelStyle}>Membership cap (leave blank for unlimited)</label>
      <input
        type="number"
        min={0}
        value={form.capacity ?? ""}
        onChange={(e) => set("capacity", e.target.value === "" ? null : Number(e.target.value))}
        placeholder="e.g. 30"
        style={{ ...inputStyle, marginBottom: 4 }}
      />
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Once paid registrations reach this number, new sign-ups are offered a waitlist instead.
      </p>

      <label style={labelStyle}>Registration payment</label>
      <select value={form.paymentMethod ?? "online"} onChange={(e) => set("paymentMethod", e.target.value as "online" | "cash")} style={{ ...inputStyle, marginBottom: 14 }}>
        <option value="online">Online payment</option>
        <option value="cash">Cash on arrival</option>
      </select>

      <label style={labelStyle}>Map link (optional)</label>
      <input value={form.mapUrl ?? ""} onChange={(e) => set("mapUrl", e.target.value)} placeholder="Google Maps link" style={{ ...inputStyle, marginBottom: 14 }} />

      <label style={labelStyle}>Contact phone (optional)</label>
      <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. 01 234 5678" style={{ ...inputStyle, marginBottom: 14 }} />

      <label style={labelStyle}>Description</label>
      <textarea value={form.blurb} onChange={(e) => set("blurb", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <label style={labelStyle}>What's included (one per line)</label>
      <textarea value={includesText} onChange={(e) => setIncludesText(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <label style={labelStyle}>Accessibility (one per line, e.g. "Wheelchair accessible pitch-side access")</label>
      <textarea value={accessibilityText} onChange={(e) => setAccessibilityText(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <div style={{ marginBottom: 18 }}>
        <MultiImageUpload images={form.images ?? []} onChange={(images) => set("images", images)} />
      </div>

      {error && <p className="pop-in" style={{ color: "#b00020", fontSize: 13, margin: "0 0 12px", background: "#FBEAEA", padding: "9px 12px", borderRadius: 10 }}>{error}</p>}
      <Button variant="orange" disabled={saving || !form.name} onClick={save}>
        {clubId === "new" ? "Create (goes to admin for approval)" : "Save changes"}
      </Button>

      {clubId !== "new" && (
        <>
          <ClubSessionsManager clubId={clubId} />
          <ClubWaitlistPanel clubId={clubId} />
        </>
      )}
    </>
  );
}

// --- recurring sessions (Tier 3) — was API-only; club_sessions CRUD had no
// vendor screen, and RegistrationFlow.tsx's session picker had nothing to
// show for any club until a vendor could actually add one here. ------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ClubSessionsManager({ clubId }: { clubId: string }) {
  const [sessions, setSessions] = useState<ClubSession[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [time, setTime] = useState("18:00");
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState("");
  const [instructorName, setInstructorName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = () => {
    fetchClubSessions(clubId).then(setSessions).catch(() => {});
  };
  useEffect(load, [clubId]);

  const add = async () => {
    setAdding(true);
    try {
      await createClubSession({ clubId, dayOfWeek, time, label: label || undefined, capacity: capacity ? Number(capacity) : undefined, instructorName: instructorName || undefined });
      setLabel("");
      setCapacity("");
      setInstructorName("");
      setAddOpen(false);
      load();
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    await deleteClubSession(id);
    load();
    setConfirmingId(null);
  };

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${colors.border}` }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Recurring sessions</h4>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Optional — lets a family pick a specific day/time when registering instead of one flat sign-up.
      </p>
      {sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {sessions.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: 10, padding: "8px 12px", fontSize: 13.5 }}>
              <span>
                {DAY_NAMES[s.dayOfWeek]} {s.time}
                {s.label ? ` — ${s.label}` : ""}
                {s.capacity ? ` · cap ${s.capacity}` : ""}
                {s.instructorName ? ` · ${s.instructorName}` : ""}
              </span>
              <button onClick={() => setConfirmingId(s.id)} aria-label="Remove session" style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint, display: "flex" }}>
                <TrashIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {addOpen ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} style={{ ...inputStyle, width: 130 }}>
            {DAY_NAMES.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, width: 110 }} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" style={{ ...inputStyle, width: 150 }} />
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Cap" type="number" style={{ ...inputStyle, width: 70 }} />
          <input value={instructorName} onChange={(e) => setInstructorName(e.target.value)} placeholder="Instructor (optional)" style={{ ...inputStyle, width: 150 }} />
          <Button variant="ghost" onClick={add} disabled={adding}>
            <PlusIcon size={14} /> Add
          </Button>
          <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setAddOpen(true)}>
          <PlusIcon size={14} /> Add session
        </Button>
      )}

      <ConfirmDialog
        open={!!confirmingId}
        title="Remove this session?"
        message="This permanently deletes the recurring session — it can't be undone."
        confirmLabel="Remove"
        onConfirm={() => confirmingId && remove(confirmingId)}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}

// --- club waitlist (Tier 3) — the vendor side of the MVP waitlist feature
// genuinely had no route at all until now, not just no UI. -----------------

function ClubWaitlistPanel({ clubId }: { clubId: string }) {
  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);

  useEffect(() => {
    fetchVendorClubWaitlist(clubId).then(setEntries).catch(() => setEntries([]));
  }, [clubId]);

  if (entries === null) return null;

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${colors.border}` }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Waitlist</h4>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Only fills once this club has a membership cap set above and is full.
      </p>
      {entries.length === 0 ? (
        <EmptyState icon={<UsersIcon size={20} />} title="Nobody waiting" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: 10, padding: "8px 12px", fontSize: 13.5 }}>
              <span>{e.name || e.email || "Anonymous"} {e.email && <span style={{ color: colors.mutedLight }}>· {e.email}</span>}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "3px 10px",
                  background: e.status === "offered" ? colors.orangeBg : colors.panel,
                  color: e.status === "offered" ? colors.orangeDark : colors.muted,
                }}
              >
                {e.status === "offered" ? "Offered a spot" : "Waiting"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- notifications tab (new bookings/registrations on the vendor's own listings) -

// Composer (Tier 3) — sendVendorMessage/fetchVendorMessages existed with no
// form anywhere to use them. Distinct from the automatic notification feed
// below: this is a vendor-authored message to everyone with a paid
// booking/registration on one listing.
function MessageComposer({ listings }: { listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] } }) {
  const options = [
    ...listings.centres.map((c) => ({ listingType: "centre" as const, listingId: c.id, name: c.name })),
    ...listings.clubs.map((c) => ({ listingType: "club" as const, listingId: c.id, name: c.name })),
  ];
  const [target, setTarget] = useState(options[0] ? `${options[0].listingType}:${options[0].listingId}` : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: number; subject: string; body: string; createdAt: string }[]>([]);

  const loadSent = () => fetchVendorMessages().then(setSent).catch(() => {});
  useEffect(() => {
    loadSent();
  }, []);

  const send = async () => {
    const [listingType, listingId] = target.split(":") as ["centre" | "club", string];
    if (!listingType || !listingId || !subject.trim() || !body.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await sendVendorMessage({ listingType, listingId, subject: subject.trim(), body: body.trim() });
      setResult(`Sent to ${res.recipientCount} ${res.recipientCount === 1 ? "person" : "people"}.`);
      setSubject("");
      setBody("");
      loadSent();
    } catch {
      setResult("You don't have permission to send messages — this needs the communications role.");
    } finally {
      setSending(false);
    }
  };

  if (options.length === 0) return null;

  return (
    <Card style={{ marginBottom: 20 }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Message your participants</h4>
      <label style={labelStyle}>Listing</label>
      <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
        {options.map((o) => (
          <option key={`${o.listingType}:${o.listingId}`} value={`${o.listingType}:${o.listingId}`}>{o.name}</option>
        ))}
      </select>
      <label style={labelStyle}>Subject</label>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
      <label style={labelStyle}>Message</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", marginBottom: 12 }} />
      {result && <p style={{ fontSize: 13, color: colors.greenText, fontWeight: 600, margin: "0 0 12px" }}>{result}</p>}
      <Button onClick={send} disabled={sending || !subject.trim() || !body.trim()}>
        {sending ? "Sending…" : "Send to everyone with a paid booking"}
      </Button>

      {sent.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 10 }}>SENT</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sent.slice(0, 5).map((m) => (
              <div key={m.id} style={{ fontSize: 13, background: colors.bg, borderRadius: 10, padding: "8px 12px" }}>
                <strong>{m.subject}</strong>
                <div style={{ color: colors.mutedLight, fontSize: 12, marginTop: 2 }}>{formatDate(m.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function MessagesTab({ onRead, listings }: { onRead: () => void; listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] } }) {
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
    <div className="fade-panel">
      <MessageComposer listings={listings} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
    </div>
  );
}

// --- bookings/registrations tab --------------------------------------------

// Manual check-in (Tier 3, FUTURE-scaffolding made usable) — no QR/hardware,
// just a button a vendor taps at the door. Doesn't preload existing status
// (would need a bulk endpoint that doesn't exist yet) — starts unchecked
// each page load and reflects clicks made in this session.
function CheckInButton({ kind, reference }: { kind: "booking" | "registration"; reference: string }) {
  const [checkedIn, setCheckedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await checkInBooking(kind, reference);
      setCheckedIn(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check in");
    } finally {
      setBusy(false);
    }
  };

  if (checkedIn) {
    return <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "3px 10px", flex: "none" }}>✓ Checked in</span>;
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
      {error && <span style={{ fontSize: 10.5, color: colors.orangeDark }}>{error}</span>}
      <button
        onClick={handleClick}
        disabled={busy}
        style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, border: "none", borderRadius: 999, padding: "3px 10px", cursor: "pointer", flex: "none" }}
      >
        {busy ? "…" : "Check in"}
      </button>
    </span>
  );
}

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
        {bookings.length === 0 ? (
          <EmptyState icon={<CalendarIcon size={26} />} title="No bookings yet" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Guest</th>
                  <th style={thStyle}>Centre</th>
                  <th style={thStyle}>Date/Time</th>
                  <th style={thStyle}>Contact</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.ref} style={{ opacity: b.status === "cancelled" ? 0.55 : 1 }}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar name={b.name} size={24} />
                        {b.name}
                      </div>
                    </td>
                    <td style={tdStyle}>{b.centreName}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{b.date} {b.time}</td>
                    <td style={{ ...tdStyle, color: colors.mutedLight }}>{b.email}, {b.phone}</td>
                    <td style={tdStyle}>
                      {b.status === "cancelled" ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#b00020", background: "#F6E3E3", borderRadius: 999, padding: "2px 8px" }}>Cancelled</span>
                      ) : (
                        <CheckInButton kind="booking" reference={b.ref} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Club registrations</h4>
        {registrations.length === 0 ? (
          <EmptyState icon={<AwardIcon size={26} />} title="No registrations yet" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Child</th>
                  <th style={thStyle}>Club</th>
                  <th style={thStyle}>Contact</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((r) => (
                  <tr key={r.ref} style={{ opacity: r.status === "cancelled" ? 0.55 : 1 }}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar name={`${r.childFirst} ${r.childLast}`} size={24} />
                        {r.childFirst} {r.childLast}
                      </div>
                    </td>
                    <td style={tdStyle}>{r.clubName}</td>
                    <td style={{ ...tdStyle, color: colors.mutedLight }}>{r.email}, {r.phone}</td>
                    <td style={tdStyle}>
                      {r.status === "cancelled" ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#b00020", background: "#F6E3E3", borderRadius: 999, padding: "2px 8px" }}>Cancelled</span>
                      ) : (
                        <CheckInButton kind="registration" reference={r.ref} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// --- demand intelligence (Tier 3) — search_misses was logged with nothing
// to show it. Purely descriptive: no action a vendor can take from here
// beyond deciding to create a listing/session that matches the demand. ------

function DemandTab() {
  const [rows, setRows] = useState<DemandRow[] | "forbidden" | null>(null);
  const [scope, setScope] = useState<"own" | "all">("own");

  useEffect(() => {
    setRows(null);
    fetchVendorDemand(scope)
      .then(setRows)
      .catch(() => setRows("forbidden"));
  }, [scope]);

  return (
    <div className="fade-panel">
      <DemandSignalsView
        title="What people are searching for"
        subtitle={
          scope === "own"
            ? "Searches in your county for your kind of listing that returned nothing — a signal for what to add next."
            : "Every unmet search across the platform, not just your own county or listing type."
        }
        rows={rows}
        scope={{ value: scope, onChange: setScope }}
      />
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
// Deliberately NOT a uniform CRUD list: for the common case (one listing of
// a given type) this renders a rich profile view of that listing instead —
// adding another location is a rare action, not the page's headline
// purpose, so it's a small link rather than a big header button. A proper
// list/table view only kicks in once there are genuinely multiple listings
// of the same type to manage.

function ListingFactsStrip({ kind, listing }: { kind: "centre" | "club"; listing: VendorListingSummary }) {
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: colors.mutedLight }}>
      {kind === "centre" ? (
        <>
          {listing.capacity != null && <span>Capacity {listing.capacity}</span>}
          {listing.fromPrice != null && <span>from €{listing.fromPrice}/hr</span>}
        </>
      ) : (
        <>
          {listing.ages && <span>{listing.ages}</span>}
          {listing.price != null && listing.unit && (
            <span>
              €{listing.price} / {listing.unit}
            </span>
          )}
        </>
      )}
    </span>
  );
}

function ListingProfileCard({
  kind,
  listing,
  onEdit,
  onDelete,
}: {
  kind: "centre" | "club";
  listing: VendorListingSummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const publicHref = kind === "centre" ? `/centres/${listing.id}` : `/clubs/${listing.id}`;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 260px", minHeight: 200, background: colors.panel }}>
          {listing.image ? (
            <img src={listing.image} alt="" style={{ width: "100%", height: "100%", minHeight: 200, objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", color: colors.faint }}>
              {kind === "centre" ? <BuildingIcon size={32} /> : <BallIcon size={32} />}
            </div>
          )}
        </div>
        <div style={{ flex: "1 1 320px", padding: 24, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: 0, letterSpacing: "-.01em" }}>{listing.name}</h3>
            <StatusBadge status={listing.status} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 13, color: colors.mutedLight }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <PinIcon size={13} />
              {listing.area}, {listing.county}
            </span>
            {listing.reviews > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <StarIcon size={13} />
                {listing.rating.toFixed(1)} ({listing.reviews})
              </span>
            )}
          </div>
          <ListingFactsStrip kind={kind} listing={listing} />
          <p
            style={{
              fontSize: 13.5,
              color: listing.blurb ? colors.text : colors.faint,
              margin: 0,
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {listing.blurb || "No description yet — add one so families know what to expect."}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: "auto", paddingTop: 6 }}>
            <Button onClick={onEdit}>
              <EditIcon size={14} /> {listing.status === "approved" ? "Edit details" : "Finish setup"}
            </Button>
            {listing.status === "approved" ? (
              <LinkButton variant="ghost" href={publicHref} target="_blank">
                <EyeIcon size={14} /> View live listing
              </LinkButton>
            ) : (
              <span style={{ fontSize: 12.5, color: colors.faint }}>Preview available once approved</span>
            )}
            <Button variant="danger" onClick={onDelete} style={{ marginLeft: "auto" }}>
              <TrashIcon size={14} /> Delete
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ListingsTable({
  kind,
  rows,
  onEdit,
  onDelete,
}: {
  kind: "centre" | "club";
  rows: VendorListingSummary[];
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}></th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Location</th>
            <th style={thStyle}>{kind === "centre" ? "Bookings" : "Registrations"}</th>
            <th style={thStyle}>Views</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ ...tdStyle, width: 44 }}>
                {r.image ? (
                  <img src={r.image} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: colors.panel }} />
                )}
              </td>
              <td style={tdStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700 }}>{r.name}</span>
                  <StatusBadge status={r.status} />
                </div>
              </td>
              <td style={tdStyle}>
                {r.area}, {r.county}
              </td>
              <td style={tdStyle}>{r.bookingsCount}</td>
              <td style={tdStyle}>{r.views}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <Button variant="ghost" onClick={() => onEdit(r.id)}>
                    <EditIcon size={13} />
                  </Button>
                  <Button variant="danger" onClick={() => onDelete(r.id, r.name)}>
                    <TrashIcon size={13} />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Renders only when there's at least one listing of this type — a type
// with zero listings gets no section at all (see ListingsTab's shared
// bottom action bar instead of a per-type empty-state placeholder).
function ListingSection({
  kind,
  title,
  addLabel,
  addButtonVariant,
  rows,
  onEdit,
  onNew,
  onDelete,
}: {
  kind: "centre" | "club";
  title: string;
  addLabel: string;
  addButtonVariant?: "primary" | "orange";
  rows: VendorListingSummary[];
  onEdit: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (rows.length === 1) {
    return (
      <div>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "0 0 14px", letterSpacing: "-.01em" }}>{title}</h3>
        <ListingProfileCard kind={kind} listing={rows[0]} onEdit={() => onEdit(rows[0].id)} onDelete={() => onDelete(rows[0].id, rows[0].name)} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: 0, letterSpacing: "-.01em" }}>{title}</h3>
        <Button variant={addButtonVariant} onClick={onNew}>
          {addLabel}
        </Button>
      </div>
      <ListingsTable kind={kind} rows={rows} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

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
  const [confirming, setConfirming] = useState<{ type: "centre" | "club"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      if (confirming.type === "centre") await deleteVendorCentre(confirming.id);
      else await deleteVendorClub(confirming.id);
      reload();
    } finally {
      setDeleting(false);
      setConfirming(null);
    }
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      {vendorType && <SetupChecklist vendorType={vendorType} listings={listings} />}
      {activeCentres.length > 0 && (
        <ListingSection
          kind="centre"
          title="Community centres"
          addLabel="+ Add centre"
          rows={activeCentres}
          onEdit={onEditCentre}
          onNew={onNewCentre}
          onDelete={(id, name) => setConfirming({ type: "centre", id, name })}
        />
      )}

      {activeClubs.length > 0 && (
        <ListingSection
          kind="club"
          title="Sports clubs"
          addLabel="+ Add club"
          addButtonVariant="orange"
          rows={activeClubs}
          onEdit={onEditClub}
          onNew={onNewClub}
          onDelete={(id, name) => setConfirming({ type: "club", id, name })}
        />
      )}

      {/* Single shared "add a location" bar — covers both the true empty
          case (no listings of either type) and growing into a second type
          or another location of one you already have, rather than a
          separate empty-state placeholder per missing type. Plain inline
          text links, not full buttons — this is a rare, low-emphasis action. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <span style={{ fontSize: 14, color: colors.mutedLight }}>Manage another location?</span>
        <button
          onClick={onNewCentre}
          className="link-accent"
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: colors.greenText, display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}
        >
          <PlusIcon size={13} /> Add centre
        </button>
        <button
          onClick={onNewClub}
          className="link-accent"
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: colors.orangeDark, display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}
        >
          <PlusIcon size={13} /> Add club
        </button>
      </div>

      <ConfirmDialog
        open={!!confirming}
        title={`Delete ${confirming?.name ?? "this listing"}?`}
        message="This removes it from your dashboard and from public view. Existing bookings/registrations already made are unaffected."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

// --- main dashboard ------------------------------------------------------

type VendorTab = "overview" | "listings" | "messages" | "bookings" | "demand" | "programs" | "schedule" | "org";

const VENDOR_TABS: { key: VendorTab; label: string; icon: ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <EyeIcon size={15} /> },
  { key: "listings", label: "Listings", icon: <ClipboardIcon size={15} /> },
  { key: "programs", label: "Programs", icon: <CalendarIcon size={15} /> },
  { key: "schedule", label: "Schedule", icon: <CalendarIcon size={15} /> },
  { key: "messages", label: "Messages", icon: <ChatIcon size={15} /> },
  { key: "bookings", label: "Bookings & registrations", icon: <CalendarIcon size={15} /> },
  { key: "demand", label: "Demand", icon: <TrendUpIcon size={15} /> },
  { key: "org", label: "Organisation", icon: <UsersIcon size={15} /> },
];

// Static engagement-tips panel at the bottom of Overview — not tied to any
// fetched data, just evergreen advice for getting more bookings.
const TIPS = [
  { title: "Complete your profile", desc: "Listings with photos, opening hours, and a full description get more clicks." },
  { title: "Keep your calendar updated", desc: "Block off unavailable dates so guests don't try to book them." },
  { title: "Respond to messages quickly", desc: "Fast replies build trust and turn enquiries into bookings." },
];

function TipsPanel() {
  return (
    <Card style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 320px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "#FFF3D6", color: "#9A6B00", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <LightbulbIcon size={17} />
          </div>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: 0 }}>Tips to get more bookings</h4>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {TIPS.map((t) => (
            <div key={t.title} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: colors.greenBg, color: colors.green, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", marginTop: 1 }}>
                <CheckIcon size={12} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.title}</div>
                <div style={{ color: colors.muted, fontSize: 12.5 }}>{t.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hide-mobile" style={{ width: 170, height: 130, flex: "none" }}>
        <CommunityIllustration />
      </div>
    </Card>
  );
}

// At-a-glance landing tab — the KPI row (moved here from the top-of-page
// header, which used to render it unconditionally on every tab), a
// same-day summary of hall bookings + club sessions (GET /vendor/today),
// the standalone Schedule tab's own Today/Upcoming (program sessions), and
// a static engagement-tips panel.
function VendorOverviewTab({ stats, unreadCount }: { stats: VendorStats; unreadCount: number }) {
  const [today, setToday] = useState<VendorToday | null>(null);
  const [todayError, setTodayError] = useState(false);
  useEffect(() => {
    fetchVendorToday()
      .then(setToday)
      .catch(() => setTodayError(true));
  }, []);

  const nothingToday = today !== null && today.bookings.length === 0 && today.clubSessions.length === 0;

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <StatRow marginBottom={0}>
        <StatTile icon={<BuildingIcon size={19} />} iconBg={colors.greenBg} iconColor={colors.green} value={stats.centresLive} label="Community centres" sublabel="Live listings" sublabelColor={colors.greenText} />
        <StatTile icon={<BallIcon size={19} />} iconBg={colors.orangeBg} iconColor={colors.orange} value={stats.clubsLive} label="Sports clubs" sublabel="Live listings" sublabelColor={colors.orangeDark} />
        <StatTile icon={<CalendarIcon size={19} />} iconBg="#E9F0FC" iconColor="#3B5FCC" value={stats.totalBookings} label="Total bookings" sublabel="All time" sublabelColor="#3B5FCC" />
        <StatTile icon={<EyeIcon size={19} />} iconBg="#F1E9FC" iconColor="#7B4FCC" value={stats.totalViews} label="Total views" sublabel="All time" sublabelColor="#7B4FCC" />
        <StatTile icon={<ChatIcon size={19} />} iconBg={colors.panel} iconColor={colors.muted} value={unreadCount} label="Unread messages" sublabel="From users" sublabelColor={colors.mutedLight} />
      </StatRow>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Today — hall bookings &amp; club sessions</h4>
        {todayError ? (
          <p style={{ fontSize: 13, color: colors.orangeDark }}>Couldn't load today's activity — try refreshing.</p>
        ) : today === null ? (
          <p style={{ fontSize: 13, color: colors.faint }}>Loading…</p>
        ) : nothingToday ? (
          <EmptyState icon={<CalendarIcon size={22} />} title="Nothing on today" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {today.bookings.map((b) => (
              <div key={b.ref} style={{ display: "flex", justifyContent: "space-between", background: colors.greenBg, borderRadius: 10, padding: "10px 14px", fontSize: 13.5 }}>
                <span><strong>{b.time}</strong> · {b.centreName} — {b.name}</span>
                <span>{b.guests} guests</span>
              </div>
            ))}
            {today.clubSessions.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", background: colors.orangeBg, borderRadius: 10, padding: "10px 14px", fontSize: 13.5 }}>
                <span><strong>{s.time}</strong> · {s.clubName}{s.label ? ` — ${s.label}` : ""}</span>
                <span>{s.instructorName || (s.capacity ? `cap ${s.capacity}` : "")}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <VendorScheduleTab />
      <TipsPanel />
    </div>
  );
}

export function VendorDashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<VendorTab>(VENDOR_TABS.some((o) => o.key === initialTab) ? (initialTab as VendorTab) : "overview");
  const [navOpen, setNavOpen] = useState(false);
  const [listings, setListings] = useState<{ centres: VendorListingSummary[]; clubs: VendorListingSummary[] }>({ centres: [], clubs: [] });
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [editingCentre, setEditingCentre] = useState<string | "new" | null>(null);
  const [editingClub, setEditingClub] = useState<string | "new" | null>(null);
  const [creatingProgram, setCreatingProgram] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { setOpenNav } = useDashboardNav();

  // Registers the Header.tsx burger's click handler while this page is
  // mounted — see DashboardNavContext.
  useEffect(() => {
    setOpenNav(() => setNavOpen(true));
    return () => setOpenNav(null);
  }, [setOpenNav]);

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

  if (loading) return <PageSpinner />;
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

  // "Listings" reads like inventory management, which is misleading for the
  // overwhelmingly common case of a vendor with a single location — swap in
  // a singular, ownership-flavoured label ("My centre"/"My club") whenever
  // there's exactly one (or zero, pre-first-listing) active listing shown.
  // Both listing types are always manageable regardless of the vendor's
  // signup-time vendorType (that only picks the type of their initial
  // listing) — see ListingsTab, which shows both sections unconditionally.
  const activeCentresCount = listings.centres.filter((c) => c.status !== "deleted").length;
  const activeClubsCount = listings.clubs.filter((c) => c.status !== "deleted").length;
  const shownListingsCount = activeCentresCount + activeClubsCount;
  const listingsTabLabel =
    shownListingsCount > 1
      ? "Listings"
      : activeCentresCount === 1
        ? "My centre"
        : activeClubsCount === 1
          ? "My club"
          : "My listing";
  const displayTabs = VENDOR_TABS.map((t) => (t.key === "listings" ? { ...t, label: listingsTabLabel } : t));

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "40px 24px 90px" }}>
        {tab === "overview" && (
          <div style={{ background: colors.greenBg, borderRadius: 22, padding: "28px 28px 24px", marginBottom: 32 }}>
            <DashboardTopPanel
              title={user.name}
              subtitle={`Vendor dashboard · ${user.email}`}
              avatarName={user.name}
              accent="green"
              tabs={VENDOR_TABS}
              activeTab={tab}
              onTabChange={setTab}
              bottomSpacing={0}
              hideTabs
              badge={
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {user.providerTier !== "standard" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#fff", color: colors.greenText, borderRadius: 20, padding: "3px 10px 3px 8px", fontSize: 12, fontWeight: 700 }}>
                      <CheckCircleIcon size={13} /> Verified vendor
                    </span>
                  )}
                  <span style={{ display: "inline-flex", alignItems: "center", background: "#fff", color: colors.muted, borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
                    Member since {formatMemberSince(user.createdAt)}
                  </span>
                </div>
              }
            />
          </div>
        )}

        <NavSidebar open={navOpen} onClose={() => setNavOpen(false)} title="Vendor dashboard" options={displayTabs} value={tab} onChange={setTab} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 21, margin: 0, letterSpacing: "-.01em" }}>
            {displayTabs.find((t) => t.key === tab)?.label}
          </h2>
          {tab === "programs" && (
            <Button onClick={() => setCreatingProgram(true)}>
              <PlusIcon size={14} /> Add program
            </Button>
          )}
        </div>

        {tab === "overview" && stats && <VendorOverviewTab stats={stats} unreadCount={unreadCount} />}

        {tab === "listings" && (
          <ListingsTab
            vendorType={user.vendorType}
            listings={listings}
            onEditCentre={setEditingCentre}
            onEditClub={setEditingClub}
            onNewCentre={() => setEditingCentre("new")}
            onNewClub={() => setEditingClub("new")}
            reload={reload}
          />
        )}

        {tab === "messages" && <MessagesTab onRead={loadUnreadCount} listings={listings} />}
        {tab === "bookings" && <BookingsTab />}
        {tab === "demand" && <DemandTab />}
        {tab === "programs" && <VendorProgramsTab listings={listings} creatingOpen={creatingProgram} onCreatingOpenChange={setCreatingProgram} />}
        {tab === "schedule" && <VendorScheduleTab />}
        {tab === "org" && <VendorOrgTab />}

        <Drawer
          open={!!editingCentre}
          onClose={() => setEditingCentre(null)}
          size="wide"
          title={editingCentre === "new" ? "New community centre" : listings.centres.find((c) => c.id === editingCentre)?.name ?? "Edit community centre"}
        >
          {editingCentre && <CentreEditor centreId={editingCentre} onSaved={reload} />}
        </Drawer>
        <Drawer
          open={!!editingClub}
          onClose={() => setEditingClub(null)}
          size="wide"
          title={editingClub === "new" ? "New sports club" : listings.clubs.find((c) => c.id === editingClub)?.name ?? "Edit sports club"}
        >
          {editingClub && <ClubEditor clubId={editingClub} onSaved={reload} />}
        </Drawer>
      </section>
    </div>
  );
}
