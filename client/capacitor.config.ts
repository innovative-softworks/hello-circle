import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ie.hellocircle.app',
  appName: 'Hello Circle',
  webDir: 'dist',
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
