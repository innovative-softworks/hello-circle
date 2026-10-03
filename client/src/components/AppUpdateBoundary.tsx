import { Component, type ReactNode } from "react";
import { isChunkLoadError, isPageLeaving, isStaleReloadInProgress, recoverFromStaleBuild } from "../chunkRecovery";
import { LoadErrorState } from "./ui";

// HC-QA-090 — the app had no error boundary at all, so one failed lazy chunk
// (an open tab after a deploy) unmounted everything: a blank page. A stale
// chunk now reloads once, or offers "Refresh to continue"; any other render
// error gets a recoverable message instead of a blank page. `resetKey` (the
// route) clears the error when the user navigates elsewhere.

type Props = { children: ReactNode; resetKey: string };
type State = { error: unknown; resetKey: string; reloading: boolean };

export class AppUpdateBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey, reloading: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey, reloading: false };
    return null;
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error) && recoverFromStaleBuild()) this.setState({ reloading: true });
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    // A recovery reload is already under way (possibly started by the
    // vite:preloadError listener) — show nothing rather than a flash of error.
    if (reloading || isStaleReloadInProgress() || isPageLeaving()) return null;
    const stale = isChunkLoadError(error);
    return (
      <div style={{ maxWidth: 560, margin: "48px auto", padding: "0 16px" }}>
        <LoadErrorState
          title={stale ? "HelloCircle has been updated" : "Something went wrong"}
          detail={stale ? "Refresh to continue — you'll get the latest version." : "This page couldn't be shown. Refreshing usually fixes it."}
          retryLabel="Refresh"
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
}
