// Booking kit — keeps a server quote in step with the form. Re-asks the
// server (debounced) whenever the inputs change, and only ever shows the
// answer to the LATEST request: a slow response for old inputs can't
// overwrite a newer one. The quote itself is never edited on the client.

import { useEffect, useReducer, useRef } from "react";

export type QuoteState<Q> =
  | { status: "idle"; quote: null; error: null; seq: number }
  | { status: "loading"; quote: Q | null; error: null; seq: number }
  | { status: "ready"; quote: Q; error: null; seq: number }
  | { status: "error"; quote: null; error: string; seq: number };

export type QuoteAction<Q> =
  | { type: "request"; seq: number }
  | { type: "success"; seq: number; quote: Q }
  | { type: "failure"; seq: number; error: string }
  | { type: "reset" };

export function initialQuoteState<Q>(): QuoteState<Q> {
  return { status: "idle", quote: null, error: null, seq: 0 };
}

export function quoteReducer<Q>(state: QuoteState<Q>, action: QuoteAction<Q>): QuoteState<Q> {
  switch (action.type) {
    case "request":
      // Keep the previous quote visible (dimmed) while the new one loads.
      return { status: "loading", quote: state.status === "ready" || state.status === "loading" ? state.quote : null, error: null, seq: action.seq };
    case "success":
      if (action.seq !== state.seq) return state;
      return { status: "ready", quote: action.quote, error: null, seq: state.seq };
    case "failure":
      if (action.seq !== state.seq) return state;
      // A stale price is worse than none: drop it so nobody pays an old total.
      return { status: "error", quote: null, error: action.error, seq: state.seq };
    case "reset":
      return { status: "idle", quote: null, error: null, seq: state.seq + 1 };
  }
}

/** `fetcher` is called with no arguments after `delayMs` of quiet whenever a
 * value in `deps` changes; pass `enabled: false` until the form has enough
 * input to price. Returns the state plus `retry()`. */
export function useQuote<Q>(fetcher: () => Promise<Q>, deps: unknown[], opts: { enabled: boolean; delayMs?: number }): QuoteState<Q> & { retry: () => void } {
  const [state, dispatch] = useReducer(quoteReducer<Q>, undefined, initialQuoteState<Q>);
  const seqRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = () => {
    const seq = ++seqRef.current;
    dispatch({ type: "request", seq });
    fetcherRef.current().then(
      (quote) => dispatch({ type: "success", seq, quote }),
      (e: unknown) => dispatch({ type: "failure", seq, error: e instanceof Error ? e.message : "We couldn't price this" })
    );
  };

  useEffect(() => {
    if (!opts.enabled) {
      seqRef.current++;
      dispatch({ type: "reset" });
      return;
    }
    const t = setTimeout(run, opts.delayMs ?? 300);
    return () => clearTimeout(t);
  }, [opts.enabled, ...deps]);

  return { ...state, retry: run };
}
