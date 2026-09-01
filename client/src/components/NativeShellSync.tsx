import { useEffect } from "react";
import { useTheme } from "../ThemeContext";
import { syncStatusBar } from "../native";

// Renders nothing — exists purely to react to theme changes from inside
// ThemeProvider's context and mirror them onto the native status bar
// (Capacitor's StatusBar API needs a literal color, so it can't just pick
// up index.css's CSS custom properties the way the web UI does).
export function NativeShellSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    syncStatusBar(resolvedTheme);
  }, [resolvedTheme]);
  return null;
}
