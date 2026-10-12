import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { History, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { POPULAR_SEARCHES, loadRecent } from "../../recentSearches";
import { colors } from "../../theme";
import { ICON_STROKE, menuLabelStyle, panelStyle } from "./headerStyles";

// One search entry point for the header (desktop field + mobile sheet).
// It doesn't search by itself: text goes to the existing Explore search page
// (/explore?q=, which runs GET /api/search and records recent searches), so
// there's still only one search engine. Circles aren't covered by
// /api/search yet (header audit P1-7) — rather than invent results, typed
// text also offers the Circles page's own search (/circles?q=).

interface Option {
  id: string;
  label: string;
  hint?: string;
  to: string;
  group: "recent" | "popular" | "query";
}

export function HeaderSearch({
  autoFocus = false,
  onDone,
  placeholder = "Search activities, circles or places…",
  inline = false,
  before,
}: {
  autoFocus?: boolean;
  onDone?: () => void;
  placeholder?: string;
  /** In a sheet: suggestions flow under the field instead of floating. */
  inline?: boolean;
  /** Rendered beside the field (the mobile search screen's Back button). */
  before?: ReactNode;
}) {
  const navigate = useNavigate();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Close on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = value.trim();
  const options: Option[] = q
    ? [
        {
          id: "all",
          label: `Search for “${q}”`,
          hint: "Activities, experiences and more",
          to: `/explore?q=${encodeURIComponent(q)}`,
          group: "query",
        },
        {
          id: "circles",
          label: `Search Circles for “${q}”`,
          hint: "Regular groups",
          to: `/circles?q=${encodeURIComponent(q)}`,
          group: "query",
        },
      ]
    : [
        ...recent.slice(0, 4).map((r, i) => ({
          id: `r${i}`,
          label: r,
          to: `/explore?q=${encodeURIComponent(r)}`,
          group: "recent" as const,
        })),
        ...POPULAR_SEARCHES.filter((p) => !recent.includes(p)).map((p, i) => ({
          id: `p${i}`,
          label: p,
          to: `/explore?q=${encodeURIComponent(p)}`,
          group: "popular" as const,
        })),
      ];

  const go = (to: string) => {
    setOpen(false);
    setActive(-1);
    setValue("");
    inputRef.current?.blur();
    onDone?.();
    navigate(to);
  };

  const submit = () => {
    if (active >= 0 && options[active]) return go(options[active].to);
    go(q ? `/explore?q=${encodeURIComponent(q)}` : "/explore?focus=1");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (options.length ? (a + 1) % options.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (options.length ? (a <= 0 ? options.length - 1 : a - 1) : -1));
    } else if (e.key === "Escape") {
      // First Escape clears, the next closes (and lets a sheet close itself).
      if (value) {
        e.preventDefault();
        e.stopPropagation();
        setValue("");
        setActive(-1);
      } else if (open && !inline) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  const groups: { key: Option["group"]; label: string | null }[] = [
    { key: "query", label: null },
    { key: "recent", label: "Recent" },
    { key: "popular", label: "Popular" },
  ];
  const showList = open && options.length > 0;

  return (
    <div
      ref={wrapRef}
      className="hc-search"
      role="search"
      // Close the suggestions once focus leaves the search (e.g. Tab to the
      // next header control), so two header menus are never open at once.
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {before}
          <div className="hc-search-field" style={{ flex: 1 }}>
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <Search size={20} strokeWidth={ICON_STROKE} />
            </span>
            <input
              ref={inputRef}
              type="search"
              value={value}
              placeholder={placeholder}
              aria-label="Search activities, circles or places"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showList}
              aria-controls={listId}
              aria-activedescendant={showList && active >= 0 ? `${baseId}-${options[active]?.id}` : undefined}
              enterKeyHint="search"
              onFocus={() => {
                setRecent(loadRecent());
                setOpen(true);
              }}
              onChange={(e) => {
                setValue(e.target.value);
                setActive(-1);
                setOpen(true);
              }}
              onKeyDown={onKeyDown}
            />
            {value && (
              <button
                type="button"
                className="hc-search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setValue("");
                  setActive(-1);
                  inputRef.current?.focus();
                }}
              >
                <X size={18} strokeWidth={ICON_STROKE} />
              </button>
            )}
          </div>
        </div>
      </form>
      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          style={
            inline
              ? { marginTop: 8 }
              : {
                  ...panelStyle,
                  left: 0,
                  right: 0,
                  maxHeight: 360,
                  overflowY: "auto",
                }
          }
        >
          {groups.map((g) => {
            const rows = options.filter((o) => o.group === g.key);
            if (rows.length === 0) return null;
            return (
              <div key={g.key} role="group" aria-label={g.label ?? "Search"}>
                {g.label && <div style={menuLabelStyle}>{g.label}</div>}
                {rows.map((o) => {
                  const i = options.indexOf(o);
                  return (
                    <div
                      key={o.id}
                      id={`${baseId}-${o.id}`}
                      role="option"
                      aria-selected={i === active}
                      className="hc-menu-row hc-search-option"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(o.to)}
                      onMouseEnter={() => setActive(i)}
                    >
                      <span style={{ display: "inline-flex", color: colors.muted }} aria-hidden="true">
                        {o.group === "recent" ? <History size={18} strokeWidth={ICON_STROKE} /> : <Search size={18} strokeWidth={ICON_STROKE} />}
                      </span>
                      <span>
                        <span style={{ display: "block" }}>{o.label}</span>
                        {o.hint && (
                          <span
                            style={{
                              display: "block",
                              fontSize: 12.5,
                              fontWeight: 400,
                              color: colors.muted,
                            }}
                          >
                            {o.hint}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
