import { useEffect, useState } from "react";
import { ApiError, fetchExperienceOptions, saveExperienceOptions } from "../../api";
import { Button, Card, LoadErrorState, PageSpinner, inputStyle } from "../ui";
import { FieldError, FieldLabel, FormErrorSummary, RequiredNote, useFormErrors, type FormError } from "../form";
import { colors } from "../../theme";
import type { ExperienceKind, OptionKind, PriceBasis, VendorOfferingOption } from "../../types";

// Participation Phase 1 — the partner's Registration tab: several options on
// one listing (e.g. KNOTS: "Participate in Pooja" per family and "Individual
// Darshan" per person), each with its own price, people included and limit.
// The server validates and prices everything; this form only collects it.
// Saving replaces the whole set under a version — if someone else saved in
// between, the server says so (409) and the form reloads instead of
// overwriting their change. Options are never deleted, only switched off, so
// bookings already made keep pointing at them (and keep their own snapshot).

interface Row extends VendorOfferingOption {
  key: string;
  /** Euro text as typed, so "11." isn't rewritten while typing. */
  priceText: string;
}

const toRow = (o: VendorOfferingOption, i: number): Row => ({ ...o, key: o.id ?? `new-${i}-${Date.now()}`, priceText: (o.priceMinor / 100).toFixed(2) });

const blank = (kind: OptionKind = "option"): Row => ({
  key: `new-${Math.random().toString(36).slice(2)}`,
  kind,
  label: "",
  description: "",
  priceMinor: 0,
  priceText: "",
  priceBasis: kind === "addon" ? "per_booking" : "per_person",
  headsPerUnit: kind === "addon" ? 0 : 1,
  ageBand: null,
  capacity: null,
  maxPerOrder: kind === "addon" ? 1 : null,
  saleStartsAt: null,
  saleEndsAt: null,
  active: true,
});

/** euro text → cents, or null when it isn't a valid amount. */
function cents(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

const fieldId = (row: Row, field: string) => `opt-${row.key}-${field}`;

export function OptionsEditor({ experienceId, kind }: { experienceId: string; kind: ExperienceKind }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [version, setVersion] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fe = useFormErrors();
  const free = kind === "volunteer";

  const load = () => {
    setLoadError(false);
    fetchExperienceOptions(experienceId)
      .then((r) => {
        setRows(r.options.map(toRow));
        setVersion(r.version);
        setEnabled(r.enabled);
        setDirty(false);
      })
      .catch(() => setLoadError(true));
  };
  useEffect(load, [experienceId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) return <LoadErrorState title="Couldn't load the registration options" onRetry={load} />;
  if (!rows) return <PageSpinner />;

  const update = (key: string, patch: Partial<Row>) => {
    setRows((list) => (list ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
    setNotice(null);
  };
  const live = rows.filter((r) => r.active);
  const off = rows.filter((r) => !r.active);

  const save = async () => {
    const errors: FormError[] = [];
    const payload: VendorOfferingOption[] = [];
    for (const [i, r] of rows.entries()) {
      const n = `Option ${i + 1}`;
      const price = free ? 0 : cents(r.priceText);
      if (r.active && !r.label.trim()) errors.push({ field: `${n} name`, fieldId: fieldId(r, "label"), message: `${n}: give it a name` });
      if (r.active && price === null) errors.push({ field: `${n} price`, fieldId: fieldId(r, "price"), message: `${n}: enter a price like 11.00 (0 for free)` });
      const { key: _key, priceText: _text, ...rest } = r;
      payload.push({ ...rest, label: r.label.trim(), priceMinor: price ?? 0 });
    }
    if (live.length > 0 && !live.some((r) => r.kind !== "addon")) errors.push({ field: "Options", message: "Add at least one option people can book, not only add-ons" });
    if (errors.length) return fe.fail(errors);
    fe.clear();
    setSaving(true);
    try {
      const r = await saveExperienceOptions(experienceId, payload, version);
      setRows(r.options.map(toRow));
      setVersion(r.version);
      setDirty(false);
      setNotice("Saved. New bookings use these options; bookings already made keep what they bought.");
    } catch (e) {
      const body = e instanceof ApiError ? e.body : {};
      if (body.code === "stale_options") {
        setNotice("Someone else saved these options while you were editing. We've loaded their version — make your change again.");
        load();
      } else {
        const index = typeof body.index === "number" ? body.index : null;
        const field = typeof body.field === "string" ? body.field : null;
        const row = index !== null ? rows[index] : null;
        fe.fail([{ field: "Options", fieldId: row ? fieldId(row, field === "priceMinor" ? "price" : field ?? "label") : undefined, message: e instanceof Error ? e.message : "Couldn't save the options" }]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Registration options</h2>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14, lineHeight: 1.5 }}>
          Sell more than one option on this listing — for example a family registration and a single ticket. People choose options when they book; the price is worked out from these, never typed in by them.
          {live.length === 0 && " With no options, the listing keeps its one price per person."}
        </p>
      </div>
      {!enabled && (
        <p role="status" style={{ margin: 0, padding: "10px 12px", background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: "var(--radius-control)", fontSize: 13.5 }}>
          Registration options aren't switched on yet. You can see the options here, but you can't change them, and the listing can't take bookings with options until they are.
        </p>
      )}
      <FormErrorSummary errors={fe.errors} focusKey={fe.focusKey} />
      {live.length > 0 && <RequiredNote style={{ margin: 0 }} />}
      {live.map((r, i) => (
        <OptionCard key={r.key} row={r} index={i} free={free} disabled={!enabled} fe={fe} onChange={(patch) => update(r.key, patch)} onRemove={() => update(r.key, { active: false })} />
      ))}
      {enabled && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={() => { setRows([...rows, blank("option")]); setDirty(true); }}>Add an option</Button>
          <Button variant="ghost" onClick={() => { setRows([...rows, blank("addon")]); setDirty(true); }}>Add an extra</Button>
        </div>
      )}
      {off.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 13.5, color: colors.muted }}>Switched-off options ({off.length})</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13.5 }}>
            {off.map((r) => (
              <li key={r.key} style={{ marginBottom: 6 }}>
                {r.label || "Unnamed option"} — €{(r.priceMinor / 100).toFixed(2)}{" "}
                {enabled && <Button variant="ghost" onClick={() => update(r.key, { active: true })} style={{ marginLeft: 8, padding: "2px 10px" }}>Switch back on</Button>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {notice && <p role="status" style={{ margin: 0, fontSize: 13.5, color: colors.muted }}>{notice}</p>}
      {enabled && (
        <div>
          <Button size="lg" onClick={save} disabled={saving || !dirty} aria-busy={saving}>{saving ? "Saving…" : "Save options"}</Button>
        </div>
      )}
    </div>
  );
}

function OptionCard({ row, index, free, disabled, fe, onChange, onRemove }: {
  row: Row;
  index: number;
  free: boolean;
  disabled: boolean;
  fe: ReturnType<typeof useFormErrors>;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const id = (f: string) => fieldId(row, f);
  const addon = row.kind === "addon";
  const perBooking = row.priceBasis === "per_booking";
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 } as const;
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <strong style={{ fontSize: 14 }}>{addon ? "Extra" : "Option"} {index + 1}</strong>
        {!disabled && <Button variant="ghost" onClick={onRemove} aria-label={`Switch off ${row.label || `option ${index + 1}`}`}>Switch off</Button>}
      </div>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={grid}>
          <div>
            <FieldLabel htmlFor={id("label")} required>Name</FieldLabel>
            <input {...fe.control(id("label"))} value={row.label} maxLength={120} onChange={(e) => onChange({ label: e.target.value })} placeholder={addon ? "e.g. Flowers" : "e.g. Participate in Pooja"} style={inputStyle} />
            <FieldError fieldId={id("label")} message={fe.messageFor(id("label"))} />
          </div>
          {!free && (
            <div>
              <FieldLabel htmlFor={id("price")} required>Price (€)</FieldLabel>
              <input {...fe.control(id("price"))} inputMode="decimal" value={row.priceText} onChange={(e) => onChange({ priceText: e.target.value })} placeholder="0.00" style={inputStyle} />
              <FieldError fieldId={id("price")} message={fe.messageFor(id("price"))} />
            </div>
          )}
          <div>
            <FieldLabel htmlFor={id("basis")}>Charged</FieldLabel>
            <select id={id("basis")} value={row.priceBasis} onChange={(e) => {
              const basis = e.target.value as PriceBasis;
              onChange({ priceBasis: basis, headsPerUnit: addon ? 0 : basis === "per_person" ? 1 : Math.max(1, row.headsPerUnit) });
            }} style={inputStyle}>
              <option value="per_person">Per person</option>
              <option value="per_booking">{addon ? "Once per booking" : "Per booking (e.g. a family)"}</option>
            </select>
          </div>
        </div>
        <div>
          <FieldLabel htmlFor={id("description")} optional>What's included</FieldLabel>
          <input id={id("description")} value={row.description} maxLength={500} onChange={(e) => onChange({ description: e.target.value })} placeholder={addon ? "" : "e.g. Pooja kit and lunch included"} style={inputStyle} />
        </div>
        <div style={grid}>
          {!addon && perBooking && (
            <div>
              <FieldLabel htmlFor={id("heads")}>People included</FieldLabel>
              <input id={id("heads")} type="number" min={1} max={50} value={row.headsPerUnit} onChange={(e) => onChange({ headsPerUnit: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} style={inputStyle} />
              <p style={{ fontSize: 12, color: colors.mutedLight, margin: "4px 0 0" }}>Counted against the capacity of each date.</p>
            </div>
          )}
          <div>
            <FieldLabel htmlFor={id("capacity")} optional>{addon ? "Available per date" : "Places per date"}</FieldLabel>
            <input id={id("capacity")} type="number" min={1} value={row.capacity ?? ""} onChange={(e) => onChange({ capacity: e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value))) })} placeholder="No own limit" style={inputStyle} />
          </div>
          <div>
            <FieldLabel htmlFor={id("max")} optional>Most per booking</FieldLabel>
            <input id={id("max")} type="number" min={1} max={50} value={row.maxPerOrder ?? ""} onChange={(e) => onChange({ maxPerOrder: e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value))) })} placeholder="No limit" style={inputStyle} />
          </div>
          <div>
            <FieldLabel htmlFor={id("ends")} optional>Sale ends</FieldLabel>
            <input id={id("ends")} type="datetime-local" value={row.saleEndsAt ? toLocalInput(row.saleEndsAt) : ""} onChange={(e) => onChange({ saleEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} style={inputStyle} />
          </div>
        </div>
      </fieldset>
    </Card>
  );
}

/** ISO instant → the value a datetime-local input shows (the viewer's local time). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
