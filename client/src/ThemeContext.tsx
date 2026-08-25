import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// Manual light/dark toggle (index.css's own dark-mode comment named this as
// the missing piece — this app previously only followed the OS's
// `prefers-color-scheme`, with no in-app control). "system" defers back to
// the OS preference by removing the `data-theme` attribute entirely, which
// is what makes index.css's `@media (prefers-color-scheme: dark)` block
// take over again — "light"/"dark" stamp the attribute and force one of
// index.css's two `:root[data-theme="…"]` override blocks instead.

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "hello-circle-theme";

function applyTheme(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

function readStoredTheme(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (pref: ThemePreference) => void;
  /** The theme actually rendered right now — resolves "system" against the
   * OS preference, for callers that need a concrete light/dark (e.g. an
   * icon that shows what clicking it would switch *to*, not the raw pref). */
  resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  resolvedTheme: "light",
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((pref: ThemePreference) => {
    setThemeState(pref);
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
    applyTheme(pref);
  }, []);

  const resolvedTheme = theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;

  return <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
