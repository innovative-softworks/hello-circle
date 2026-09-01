import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { registerPushToken, unregisterPushToken } from "../api/resident";
import { useGuest } from "../GuestContext";
import { nativePlatform, registerForPush, setupPushTapListener } from "../native";

// Renders nothing — mounted inside GuestProvider (Capacitor migration
// Phase 5) so it can react to resident sign-in/out. Registers this device
// for push once a resident is signed in (never for a pure anonymous
// guest — there's no residentId for the server to key device_push_tokens
// on), and unregisters on sign-out so a shared/reused device stops
// receiving push for an account no longer active on it. No-op on web (see
// native.ts's isNative-gated exports).
export function NativePushSync() {
  const { resident } = useGuest();
  const navigate = useNavigate();
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!resident) {
      if (tokenRef.current) {
        unregisterPushToken(tokenRef.current).catch(() => {});
        tokenRef.current = null;
      }
      return;
    }
    registerForPush((token) => {
      tokenRef.current = token;
      registerPushToken({ token, platform: nativePlatform() }).catch(() => {});
    });
    // Deliberately no cleanup here that unregisters the token — losing sign-
    // in state (resident -> null) is handled by the branch above; unmounting
    // this component (e.g. a route change) should NOT unregister a device
    // that's still validly signed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident?.id]);

  useEffect(() => {
    return setupPushTapListener((path) => navigate(path));
  }, [navigate]);

  return null;
}
