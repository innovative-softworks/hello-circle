import { useEffect, useRef, useState } from "react";
import { searchAddress, type AddressSuggestion } from "../api";
import { SinglePinMap } from "./SinglePinMap";
import { Button, Spinner } from "./ui";
import { colors, radius } from "../theme";

// Address search + map confirmation (Form System Audit, Phase 4; hardened
// for Nominatim policy compliance in the Maps cost-control follow-up pass)
// — spec §33: "Use address search, then map confirmation — don't ask users
// to enter coordinates."
//
// Deliberately NOT search-as-you-type. The public OSMF Nominatim instance's
// usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// is explicit: "Auto-complete search — This is not yet supported by
// Nominatim and you must not implement such a service on the client side
// using the API." A keystroke-debounced auto-search (this component's
// previous behavior) is exactly that, regardless of debounce length —
// debouncing reduces request volume but doesn't change what the feature
// *is*. Search now fires only on an explicit action: pressing Enter in the
// field or clicking "Search". See server/src/routes/geocode.ts for the
// server-side rate-limit/caching half of policy compliance.
export function AddressSearch({
  label = "Search for an address",
  onSelect,
}: {
  label?: string;
  onSelect: (result: AddressSuggestion) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const runSearch = () => {
    const q = query.trim();
    if (q.length < 3) return;
    setLoading(true);
    setSearched(true);
    searchAddress(q)
      .then((r) => {
        setResults(r);
        setOpen(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: colors.muted, margin: "0 0 6px", letterSpacing: ".01em" }}>{label}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearched(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Enter an address, then press Enter or Search"
            style={{
              width: "100%",
              padding: "11px 36px 11px 13px",
              border: `1px solid ${colors.inputBorder}`,
              borderRadius: 11,
              fontSize: 14,
              background: colors.surface,
              color: colors.text,
              outline: "none",
            }}
          />
          {loading && <Spinner size={16} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }} />}
        </div>
        <Button type="button" onClick={runSearch} disabled={query.trim().length < 3 || loading}>
          Search
        </Button>
      </div>
      <div style={{ fontSize: 11, color: colors.faint, marginTop: 4 }}>Address search powered by OpenStreetMap contributors.</div>
      {searched && !loading && results.length === 0 && (
        <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 6 }}>No matches — try a more specific address, or enter Area/County by hand below.</div>
      )}
      {open && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 11,
            boxShadow: "0 8px 24px rgba(20,22,20,.12)",
            zIndex: 20,
            overflow: "hidden",
          }}
        >
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lng}`}
              onClick={() => {
                onSelect(r);
                setQuery(r.label);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                borderTop: i > 0 ? `1px solid ${colors.border}` : "none",
                padding: "10px 13px",
                fontSize: 13.5,
                color: colors.text,
                cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MapConfirm({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return (
    <div>
      <p style={{ fontSize: 13, fontWeight: 600, color: colors.text, margin: "0 0 8px" }}>Is this the right location?</p>
      <div style={{ borderRadius: radius.control, overflow: "hidden" }}>
        <SinglePinMap lat={lat} lng={lng} label={label} height={200} zoom={15} />
      </div>
    </div>
  );
}
