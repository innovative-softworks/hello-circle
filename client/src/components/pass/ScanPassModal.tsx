import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button, Modal } from "../ui";
import { colors, radius } from "../../theme";
import "./pass.css";

// "Scan passes" (owner 2026-10-27): the check-in screens read the code on a
// guest's pass with the device camera. The camera's own barcode reader is
// used where the browser has one (Chrome on Android); everywhere else (iPhone
// Safari, desktop) each video frame is read with jsQR. Typing the reference
// always works too — a camera can be refused, broken or missing.
//
// `onCode` does the actual check-in and says what happened; the screen keeps
// scanning, so a host can work down a queue at the door. The same code read
// twice within a few seconds is ignored (the camera sees it many times).

export interface ScanResult {
  ok: boolean;
  message: string;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

function nativeDetector(): Detector | null {
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  try {
    return BD ? new BD({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

export function ScanPassModal({ open, onClose, title, hint, onCode }: { open: boolean; onClose: () => void; title: string; hint?: string; onCode: (text: string) => Promise<ScanResult> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<"starting" | "on" | "off">("starting");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const last = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const busyRef = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const handle = async (raw: string) => {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    const now = Date.now();
    if (text === last.current.text && now - last.current.at < 4000) return;
    last.current = { text, at: now };
    busyRef.current = true;
    setBusy(true);
    try {
      setResult(await onCodeRef.current(text));
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "That didn't work. Try again." });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setTyped("");
    last.current = { text: "", at: 0 };
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    const detector = nativeDetector();
    setCamera("starting");
    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && !busyRef.current) {
        try {
          if (detector) {
            const found = await detector.detect(video);
            if (found[0]?.rawValue) void handle(found[0].rawValue);
          } else {
            const canvas = canvasRef.current!;
            const w = video.videoWidth;
            const h = video.videoHeight;
            // Read a centred square, scaled down: quicker, and that's where people hold the code.
            const side = Math.min(w, h);
            const size = Math.min(side, 480);
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
            const img = ctx.getImageData(0, 0, size, size);
            const code = jsQR(img.data, size, size, { inversionAttempts: "dontInvert" });
            if (code?.data) void handle(code.data);
          }
        } catch {
          // A frame that can't be read is simply skipped.
        }
      }
      timer = window.setTimeout(tick, 250);
    };
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("off");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play().catch(() => {});
        }
        setCamera("on");
        tick();
      })
      .catch(() => setCamera("off"));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={hint ?? "Hold the code on their pass inside the square."}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div className="scan-frame">
          <video ref={videoRef} muted playsInline aria-label="Camera view" hidden={camera !== "on"} />
          {camera !== "on" && (
            <p className="scan-frame-msg">{camera === "starting" ? "Starting the camera…" : "The camera isn't available here. Type the reference from their pass below."}</p>
          )}
          {camera === "on" && <span className="scan-frame-box" aria-hidden="true" />}
          <canvas ref={canvasRef} hidden />
        </div>
        <div role="status" aria-live="polite" style={{ minHeight: 48 }}>
          {busy ? (
            <div className="scan-result">Checking…</div>
          ) : result ? (
            <div className={`scan-result ${result.ok ? "is-ok" : "is-bad"}`}>{result.message}</div>
          ) : null}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            last.current = { text: "", at: 0 };
            void handle(typed);
            setTyped("");
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <label htmlFor="scan-typed" className="visually-hidden">
            Reference
          </label>
          <input
            id="scan-typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value.toUpperCase())}
            placeholder="Or type the reference, e.g. HB-7KQ2P4"
            autoComplete="off"
            style={{ flex: 1, minWidth: 0, minHeight: 44, padding: "0 12px", border: `1px solid ${colors.border}`, borderRadius: radius.control, fontSize: 15, fontFamily: "ui-monospace, Menlo, monospace" }}
          />
          <Button type="submit" variant="ghost" disabled={!typed.trim() || busy}>
            Check in
          </Button>
        </form>
      </div>
    </Modal>
  );
}

/** What a pass's code says. Bookings, registrations, experiences and
 * programmes carry their reference; an activity pass carries the activity and
 * the person ("HCG:<gameId>:<residentId>"), so free joins can be scanned too. */
export type PassCode = { kind: "game"; gameId: string; residentId: string } | { kind: "booking" | "registration" | "experience" | "program" | "gameRef"; ref: string } | null;

export function readPassCode(text: string): PassCode {
  const t = text.trim();
  const g = /^HCG:([^:]+):([^:]+)$/.exec(t);
  if (g) return { kind: "game", gameId: g[1], residentId: g[2] };
  const ref = t.toUpperCase();
  if (ref.startsWith("HB-")) return { kind: "booking", ref };
  if (ref.startsWith("CR-")) return { kind: "registration", ref };
  if (ref.startsWith("EX-")) return { kind: "experience", ref };
  if (ref.startsWith("PR-")) return { kind: "program", ref };
  if (ref.startsWith("GJ-")) return { kind: "gameRef", ref };
  return null;
}

/** The code on an activity pass. */
export function gamePassCode(gameId: string, residentId: string): string {
  return `HCG:${gameId}:${residentId}`;
}
