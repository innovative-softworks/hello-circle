import { useEffect, useState } from "react";
import {
  createVendorBlock,
  createVendorRoom,
  deleteVendorBlock,
  fetchCentreHours,
  fetchVendorBlocks,
  fetchVendorCentre,
  saveCentreHours,
  updateVendorCentre,
  updateVendorRoom,
  type CentreInput,
} from "../api";
import { AddressSearch, MapConfirm } from "./AddressSearch";
import { CalendarIcon, PlusIcon } from "./icons";
import { Field, FormErrorSummary, NumberStepper, SettingsSection, TextInput } from "./form";
import { Button, ConfirmDialog, Drawer, EmptyState, inputStyle, labelStyle } from "./ui";
import { MultiImageUpload } from "./VendorImageUpload";
import { formatDate } from "../vendorFormat";
import { colors, fonts, radius } from "../theme";
import type { Centre, Room, RoomBlock } from "../types";

// Centre create/edit form + its rooms and per-day-hours sub-panels — split
// out of the original single VendorDashboard.tsx (see CLAUDE.md).

const HOUR_OPTIONS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];

function centreToInput(c: Centre): CentreInput {
  return { name: c.name, area: c.area, county: c.county, managedBy: c.managedBy, image: c.image, images: c.images, blurb: c.blurb, amenities: c.amenities, opensAt: c.opensAt, closesAt: c.closesAt, isOpen: c.isOpen, mapUrl: c.mapUrl, phone: c.phone, accessibility: c.accessibility, lat: c.lat ?? undefined, lng: c.lng ?? undefined };
}
function blankCentreInput(): CentreInput {
  return { name: "", area: "", county: "", managedBy: "", image: "", images: [], blurb: "", amenities: [], opensAt: "09:00", closesAt: "21:00", isOpen: true, mapUrl: "", phone: "", accessibility: [] };
}

// --- centre editor (details fields only — rooms/availability/hours are their
// own tab sections in VendorCentreEditPage.tsx) ------------------------------
//
// Only ever reached for an already-published centre — a new one is created
// via CentreCreationWizard.tsx instead (Form System Audit, Phase 5), so this
// no longer needs a flat "new" layout of its own; every field lives inside
// a SettingsSection.

export function CentreEditor({
  centreId,
  onSaved,
  onDirtyChange,
}: {
  centreId: string;
  onSaved: (centre: Centre) => void;
  /** Lets the parent page guard its own Back link (spec §42/61 — see
   * useUnsavedChangesGuard in form.tsx) without this editor knowing
   * anything about navigation itself. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<CentreInput>(blankCentreInput());
  const [amenitiesText, setAmenitiesText] = useState("");
  const [accessibilityText, setAccessibilityText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string; fieldId: string }[]>([]);

  useEffect(() => {
    fetchVendorCentre(centreId).then((c) => {
      setForm(centreToInput(c));
      setAmenitiesText(c.amenities.join("\n"));
      setAccessibilityText(c.accessibility.join("\n"));
    });
  }, [centreId]);

  const markDirty = () => onDirtyChange?.(true);

  const set = <K extends keyof CentreInput>(k: K, v: CentreInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors([]);
    markDirty();
  };

  const save = async () => {
    const errors: { field: string; message: string; fieldId: string }[] = [];
    if (!form.name.trim()) errors.push({ field: "name", message: "Venue name is required", fieldId: "centre-name" });
    if (!form.area.trim()) errors.push({ field: "area", message: "Area is required", fieldId: "centre-area" });
    if (!form.county.trim()) errors.push({ field: "county", message: "County is required", fieldId: "centre-county" });
    if (!form.blurb.trim()) errors.push({ field: "blurb", message: "A short description is required", fieldId: "centre-blurb" });
    setFieldErrors(errors);
    if (errors.length > 0) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const amenities = amenitiesText.split("\n").map((s) => s.trim()).filter(Boolean);
      const accessibility = accessibilityText.split("\n").map((s) => s.trim()).filter(Boolean);
      const updated = await updateVendorCentre(centreId, { ...form, amenities, accessibility });
      setSaved(true);
      onDirtyChange?.(false);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  // --- field groups, composed differently depending on mode below ---------

  const generalFields = (
    <>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input id="centre-name" value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Managed by</label>
          <input value={form.managedBy} onChange={(e) => set("managedBy", e.target.value)} style={inputStyle} />
        </div>
      </div>
      <label style={labelStyle}>Description</label>
      <p style={{ fontSize: 12, color: colors.mutedLight, margin: "-4px 0 8px" }}>
        Help people understand what this place is like — e.g. "Local sports centre with two badminton courts, changing rooms and free parking."
      </p>
      <textarea id="centre-blurb" value={form.blurb} onChange={(e) => set("blurb", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
    </>
  );

  const locationFields = (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <AddressSearch
          onSelect={(r) => {
            setForm((f) => ({ ...f, area: r.area || f.area, county: r.county || f.county, lat: r.lat, lng: r.lng }));
            setFieldErrors([]);
            markDirty();
          }}
        />
      </div>
      <div>
        <label style={labelStyle}>Area</label>
        <input id="centre-area" value={form.area} onChange={(e) => set("area", e.target.value)} style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>County</label>
        <input id="centre-county" value={form.county} onChange={(e) => set("county", e.target.value)} style={inputStyle} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>Map link (optional)</label>
        <input value={form.mapUrl ?? ""} onChange={(e) => set("mapUrl", e.target.value)} placeholder="Google Maps link" style={inputStyle} />
      </div>
      {form.lat !== undefined && form.lng !== undefined && (
        <div style={{ gridColumn: "1 / -1" }}>
          <MapConfirm lat={form.lat} lng={form.lng} label={form.name || "Your venue"} />
        </div>
      )}
    </div>
  );

  const contactField = (
    <div>
      <label style={labelStyle}>Contact phone (optional)</label>
      <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. 01 234 5678" style={inputStyle} />
    </div>
  );

  const bookingFields = (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
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
    </div>
  );

  const amenitiesField = (
    <div>
      <label style={labelStyle}>Amenities (one per line)</label>
      <textarea value={amenitiesText} onChange={(e) => { setAmenitiesText(e.target.value); setFieldErrors([]); markDirty(); }} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
    </div>
  );

  const accessibilityField = (
    <div>
      <label style={labelStyle}>Accessibility (one per line, e.g. "Wheelchair accessible entrance")</label>
      <textarea value={accessibilityText} onChange={(e) => { setAccessibilityText(e.target.value); setFieldErrors([]); markDirty(); }} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
    </div>
  );

  const photosField = <MultiImageUpload images={form.images ?? []} onChange={(images) => set("images", images)} />;

  const footer = (
    <>
      <FormErrorSummary errors={fieldErrors} />
      {error && <p className="pop-in" style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>{error}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
        <Button disabled={saving} onClick={save}>
          Save changes
        </Button>
        {saved && <span style={{ fontSize: 13, color: colors.greenText, fontWeight: 600 }}>Saved</span>}
      </div>
    </>
  );

  const amenitiesList = amenitiesText.split("\n").map((s) => s.trim()).filter(Boolean);
  const accessibilityList = accessibilityText.split("\n").map((s) => s.trim()).filter(Boolean);

  return (
    <>
      <SettingsSection title="General" summary={<>{form.name || "Not set"}{form.blurb && <div style={{ color: colors.mutedLight, fontSize: 13, marginTop: 2 }}>{form.blurb}</div>}</>}>
        {generalFields}
      </SettingsSection>
      <SettingsSection title="Location" summary={[form.area, form.county].filter(Boolean).join(", ") || "Not set"}>
        {locationFields}
      </SettingsSection>
      <SettingsSection title="Contact" summary={form.phone || "Not added"}>
        {contactField}
      </SettingsSection>
      <SettingsSection title="Booking" summary={`${form.isOpen === false ? "Closed" : "Open"} · ${form.opensAt}–${form.closesAt}`}>
        {bookingFields}
      </SettingsSection>
      <SettingsSection title="Amenities" summary={amenitiesList.length > 0 ? amenitiesList.join(" · ") : "None added"}>
        {amenitiesField}
      </SettingsSection>
      <SettingsSection title="Accessibility" summary={accessibilityList.length > 0 ? accessibilityList.join(" · ") : "None added"}>
        {accessibilityField}
      </SettingsSection>
      <SettingsSection title="Photos" summary={`${(form.images ?? []).length} photo${(form.images ?? []).length === 1 ? "" : "s"}`}>
        {photosField}
      </SettingsSection>
      {footer}
    </>
  );
}

// --- rooms (independently bookable spaces within a centre) -----------------

export function RoomsManager({ centreId, rooms, onChanged }: { centreId: string; rooms: Room[]; onChanged: () => void }) {
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

      {error && <p className="pop-in" style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>{error}</p>}

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
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
            <TextInput label="Room name" width="md" placeholder="e.g. Main Hall" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <NumberStepper label="Capacity" value={Number(form.cap) || 0} onChange={(n) => setForm((f) => ({ ...f, cap: String(n) }))} min={0} />
            <TextInput label="Rate (€/hour)" width="xs" type="number" min={0} value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
            <Field label="Payment" width="md">
              <select value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as "online" | "cash" }))} style={inputStyle}>
                <option value="online">Online payment</option>
                <option value="cash">Cash on arrival</option>
              </select>
            </Field>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={add} disabled={adding || !form.name}>
              <PlusIcon size={14} /> Add room
            </Button>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
          </div>
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

// --- availability blocks (close a date for one room, or the whole centre) --

export function AvailabilityBlocksManager({ centreId, rooms }: { centreId: string; rooms: Room[] }) {
  const [blocks, setBlocks] = useState<RoomBlock[]>([]);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockForm, setBlockForm] = useState({ date: "", reason: "", roomId: "" });
  const [confirmingBlockId, setConfirmingBlockId] = useState<number | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);

  useEffect(() => {
    fetchVendorBlocks(centreId).then(setBlocks);
  }, [centreId]);

  const addBlock = async () => {
    setBlockError(null);
    if (!blockForm.date) {
      setBlockError("Pick a date first");
      return;
    }
    try {
      await createVendorBlock(centreId, { date: blockForm.date, reason: blockForm.reason, roomId: blockForm.roomId || undefined });
    } catch (e) {
      setBlockError(e instanceof Error ? e.message : "Couldn't add that block");
      return;
    }
    fetchVendorBlocks(centreId).then(setBlocks);
    setBlockForm({ date: "", reason: "", roomId: "" });
    setBlockOpen(false);
  };

  const removeBlock = async (blockId: number) => {
    await deleteVendorBlock(centreId, blockId);
    setBlocks((rows) => rows.filter((r) => r.id !== blockId));
    setConfirmingBlockId(null);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Availability</h4>
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: 0 }}>
            Close a date (e.g. a festival) so guests can't book it — for one room, or the whole centre.
          </p>
        </div>
        <Button variant="ghost" onClick={() => setBlockOpen(true)} style={{ flex: "none" }}>
          <PlusIcon size={14} /> Block time
        </Button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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

      <Drawer open={blockOpen} onClose={() => setBlockOpen(false)} title="Block time">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TextInput label="Date" type="date" value={blockForm.date} onChange={(e) => setBlockForm((f) => ({ ...f, date: e.target.value }))} />
          <Field label="Space">
            <select value={blockForm.roomId} onChange={(e) => setBlockForm((f) => ({ ...f, roomId: e.target.value }))} style={inputStyle}>
              <option value="">Whole centre</option>
              {rooms.filter((r) => r.active).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <TextInput label="Reason (optional)" placeholder="e.g. Festival, maintenance" value={blockForm.reason} onChange={(e) => setBlockForm((f) => ({ ...f, reason: e.target.value }))} />
          {blockError && <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{blockError}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <Button onClick={addBlock}>Block time</Button>
            <Button variant="ghost" onClick={() => setBlockOpen(false)}>Cancel</Button>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmingBlockId !== null}
        title="Remove this block?"
        message="That date becomes bookable again. This is just a calendar block, not a real booking — nothing else is affected."
        confirmLabel="Remove"
        onConfirm={() => confirmingBlockId !== null && removeBlock(confirmingBlockId)}
        onCancel={() => setConfirmingBlockId(null)}
      />
    </div>
  );
}

// --- per-day opening hours (Phase B) — optional; falls back to the single
// opens_at/closes_at window above when no rows are saved. --------------

export function FacilityHoursEditor({ centreId }: { centreId: string }) {
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

  // "Copy Monday to weekdays" — the single most common case (same hours
  // Mon-Fri) shouldn't require re-entering the same two times five times.
  const copyMondayToWeekdays = () => {
    const base = days.length === 7 ? days : ensureAllDays();
    const monday = base.find((d) => d.dayOfWeek === 1);
    if (!monday) return;
    setDays(base.map((d) => (d.dayOfWeek >= 2 && d.dayOfWeek <= 5 ? { ...d, opensAt: monday.opensAt, closesAt: monday.closesAt, closed: monday.closed } : d)));
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
                      <input type="time" value={d.opensAt} onChange={(e) => update(i, { opensAt: e.target.value })} style={{ ...inputStyle, width: 132, padding: "6px 8px" }} />
                      <span>–</span>
                      <input type="time" value={d.closesAt} onChange={(e) => update(i, { closesAt: e.target.value })} style={{ ...inputStyle, width: 132, padding: "6px 8px" }} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save hours"}
            </Button>
            <Button variant="ghost" onClick={copyMondayToWeekdays}>Copy Monday to weekdays</Button>
          </div>
        </>
      )}
    </div>
  );
}
