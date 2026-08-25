import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCentres } from "../api";
import { CloseIcon } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { Button } from "../components/ui";
import { colors, fonts } from "../theme";
import type { Centre } from "../types";

// Comparison screen (IA spec §21) — scoped to community centres, per the
// spec's own framing ("most valuable for venues/facilities/adventures, not
// every activity") rather than every listing type. Up to 3 at once.

const MAX_COMPARE = 3;

const ROWS: { label: string; render: (c: Centre) => string }[] = [
  { label: "Area", render: (c) => `${c.area}, ${c.county}` },
  { label: "From", render: (c) => `€${c.from}/hr` },
  { label: "Capacity", render: (c) => String(c.capacity) },
  { label: "Rating", render: (c) => (c.reviews ? `${c.rating.toFixed(1)} (${c.reviews})` : "No reviews yet") },
  { label: "Would repeat", render: (c) => (c.wouldRepeatPercent !== null ? `${c.wouldRepeatPercent}%` : "—") },
  { label: "Opening hours", render: (c) => `${c.opensAt}–${c.closesAt}` },
  { label: "Payment", render: (c) => (c.paymentMethod === "cash" ? "Cash on arrival" : "Online") },
  { label: "Amenities", render: (c) => (c.amenities.length ? c.amenities.join(", ") : "—") },
  { label: "Accessibility", render: (c) => (c.accessibility.length ? c.accessibility.join(", ") : "—") },
];

export function Compare() {
  const navigate = useNavigate();
  const [all, setAll] = useState<Centre[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [picker, setPicker] = useState("");

  useEffect(() => {
    fetchCentres().then(setAll);
  }, []);

  const selected = selectedIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Centre => !!c);
  const available = all.filter((c) => !selectedIds.includes(c.id));

  const add = (id: string) => {
    if (id && selectedIds.length < MAX_COMPARE) setSelectedIds((ids) => [...ids, id]);
    setPicker("");
  };
  const remove = (id: string) => setSelectedIds((ids) => ids.filter((i) => i !== id));

  return (
    <div className="fade-panel">
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 90px" }}>
        <PageTitle>Compare places</PageTitle>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 24px" }}>Pick up to {MAX_COMPARE} community centres to see them side by side.</p>

        {selectedIds.length < MAX_COMPARE && (
          <select value={picker} onChange={(e) => add(e.target.value)} style={{ width: "100%", maxWidth: 360, padding: "11px 14px", borderRadius: 12, border: `1px solid ${colors.inputBorder}`, fontSize: 14.5, marginBottom: 24 }}>
            <option value="">+ Add a centre to compare…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>{c.name} — {c.area}, {c.county}</option>
            ))}
          </select>
        )}

        {selected.length === 0 ? (
          <p style={{ color: colors.faint, fontSize: 14 }}>Add at least 2 centres above to see a comparison.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 12, color: colors.faint, borderBottom: `1px solid ${colors.border}` }} />
                  {selected.map((c) => (
                    <th key={c.id} style={{ textAlign: "left", padding: "10px 12px", borderBottom: `1px solid ${colors.border}`, minWidth: 180 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                        <button onClick={() => navigate(`/centres/${c.slug ?? c.id}`)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, color: colors.text }}>
                          {c.name}
                        </button>
                        <button onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`} style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint, flex: "none" }}>
                          <CloseIcon size={14} />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <td style={{ padding: "10px 12px", fontSize: 12.5, fontWeight: 700, color: colors.muted, borderBottom: `1px solid ${colors.border}`, whiteSpace: "nowrap" }}>{row.label}</td>
                    {selected.map((c) => (
                      <td key={c.id} style={{ padding: "10px 12px", fontSize: 13.5, borderBottom: `1px solid ${colors.border}` }}>{row.render(c)}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: "14px 12px" }} />
                  {selected.map((c) => (
                    <td key={c.id} style={{ padding: "14px 12px" }}>
                      <Button onClick={() => navigate(`/book/${c.id}`)}>Book</Button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
