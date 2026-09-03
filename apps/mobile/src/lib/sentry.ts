import * as Sentry from '@sentry/react-native';

// No-op without a DSN — there's no Sentry project set up yet (external
// account step, same category as the Apple Developer/Play Console/EAS
// accounts already pending elsewhere in this repo's mobile setup).
export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] EXPO_PUBLIC_SENTRY_DSN not set — crash reporting disabled');
    return;
  }
  Sentry.init({ dsn, tracesSampleRate: 1.0 });
}
