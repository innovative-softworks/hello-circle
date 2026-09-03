import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ie.hellocircle.app',
  appName: 'Hello Circle',
  webDir: 'dist',
  // DEV-ONLY PREVIEW OVERRIDE: points the WebView at the local dev server
  // instead of the bundled dist/ assets, since this app is single-origin
  // (the server serves the built client itself, see CLAUDE.md). NOTE this
  // value is platform-dependent and must be swapped by hand: the Android
  // *emulator*'s "localhost" is its own loopback, not the host Mac's, so it
  // needs the 10.0.2.2 host alias — but the iOS *Simulator* shares the
  // Mac's network stack directly, so plain "localhost" is correct there
  // (10.0.2.2 has no meaning outside the Android emulator). Currently set
  // for iOS. cleartext is required since this is plain http, not https.
  // REMOVE this whole `server` block before any real build (device testing
  // over a real network, TestFlight/Play Store) — it hardcodes one
  // developer's machine.
  server: {
    url: 'http://localhost:3001',
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      // Hidden manually once the app shell mounts (see native.ts's
      // hideSplashScreen(), called from App.tsx) instead of racing the
      // plugin's own auto-hide timer against real boot time.
      launchAutoHide: false,
    },
    StatusBar: {
      // Content draws full-screen behind the status bar; Header.tsx pads
      // itself with env(safe-area-inset-top) to compensate, and
      // NativeShellSync keeps the status bar's own color/style in sync
      // with the app's light/dark theme at runtime.
      overlaysWebView: true,
    },
    Keyboard: {
      resize: 'body',
    },
  },
};

export default config;
