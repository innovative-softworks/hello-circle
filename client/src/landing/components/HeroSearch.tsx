import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PinIcon, SearchIcon } from "../../components/icons";
import { SEARCH_CHIPS } from "../data";
import { lc } from "../theme";

export function HeroSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("Hyderabad");

  return (
    <div
      style={{
        background: lc.white,
        borderRadius: 20,
        padding: 10,
        boxShadow: "0 20px 50px rgba(20, 23, 15, 0.14)",
        border: `1px solid ${lc.line}`,
      }}
    >
      <div className="lc-stack-mobile" style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
          <SearchIcon size={18} style={{ color: lc.inkSoft, flex: "none" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you feel like doing?"
            style={{ border: "none", outline: "none", fontSize: 16, width: "100%", background: "transparent", color: lc.ink, fontFamily: "inherit" }}
          />
        </div>
        <div style={{ width: 1, background: lc.line, margin: "8px 0" }} className="lc-hide-mobile" />
        <button
          onClick={() => setLocation(location === "Near me" ? "Hyderabad" : "Near me")}
          style={{ display: "flex", alignItems: "center", gap: 8, background: lc.paperRaised, border: "none", borderRadius: 12, padding: "10px 16px", fontSize: 14.5, fontWeight: 600, color: lc.ink, flex: "none" }}
        >
          <PinIcon size={16} style={{ color: lc.forest }} />
          {location}
        </button>
        <button
          className="lc-btn"
          style={{ background: lc.forest, color: lc.white, flex: "none" }}
          onClick={() => navigate(query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search")}
        >
          Search
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 10px 6px" }}>
        {SEARCH_CHIPS.map((chip) => (
          <button
            key={chip}
            className="lc-chip"
            onClick={() => setQuery(chip)}
            style={{ background: query === chip ? lc.forest : lc.paperRaised, color: query === chip ? lc.white : lc.inkSoft, border: "none" }}
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
