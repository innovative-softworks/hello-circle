import { useEffect, useRef, useState } from "react";
import { searchAddress, type AddressSuggestion } from "../api";
import { SinglePinMap } from "./SinglePinMap";
import { Spinner } from "./ui";
import { colors, radius } from "../theme";

// Address search + map confirmation (Form System Audit, Phase 4) — spec
// §33: "Use address search, then map confirmation — don't ask users to
// enter coordinates." Debounced against server/src/routes/geocode.ts's
// Nominatim proxy, which already throttles to that service's shared
// 1 req/sec usage policy — 400ms here just avoids firing one request per
// keystroke on top of that.

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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      searchAddress(query)
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [query]);

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
      <div style={{ position: "relative" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Start typing an address…"
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
