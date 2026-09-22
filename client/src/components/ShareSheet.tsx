import { useEffect, useState } from "react";
import { fetchMyCircles } from "../api";
import { fetchShareData, logShareEvent, shareToCircle, type ShareData, type ShareEntityType } from "../api/sharing";
import { buildEmailBody, buildEmailSubject, buildShareMessage } from "../shareMessages";
import { useGuest } from "../GuestContext";
import { colors, fonts, radius } from "../theme";
import { ChatIcon, CheckIcon, ChevronLeftIcon, ClipboardIcon, PhotoStackIcon, ShareIcon, UsersIcon } from "./icons";
import { Photo } from "./Photo";
import { Button, Drawer, PageSpinner } from "./ui";
import type { Circle } from "../types";

// Universal Sharing & Invitation system, Phase 1/3 — the ONE reusable
// <ShareSheet/> every product surface should render instead of hand-rolling
// its own navigator.share()-or-clipboard logic (see this repo's earlier
// InviteButton.tsx / ExperienceDetail.tsx's own handleShare — both now
// superseded by this, per the spec's §33 "don't duplicate sharing logic per
// page" rule). Built on the existing Drawer primitive (no new UI framework,
// per §30) — full-height slide-over on mobile already reads like a bottom
// sheet at that width.

type ChannelKey = "whatsapp" | "sms" | "telegram" | "facebook" | "messenger" | "email" | "copy" | "more";

function channelUrl(channel: ChannelKey, message: string, data: ShareData): string | null {
  const encodedMsg = encodeURIComponent(message);
  const encodedUrl = encodeURIComponent(data.url);
  switch (channel) {
    case "whatsapp":
      return `https://wa.me/?text=${encodedMsg}`;
    case "sms":
      return `sms:?&body=${encodedMsg}`;
    case "telegram":
      return `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(buildShareMessage(data).replace(data.url, "").trim())}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    case "messenger":
      return `https://www.facebook.com/dialog/send?link=${encodedUrl}&app_id=0&redirect_uri=${encodedUrl}`;
    case "email":
      return `mailto:?subject=${encodeURIComponent(buildEmailSubject(data))}&body=${encodeURIComponent(buildEmailBody(data))}`;
    default:
      return null;
  }
}

function ChannelButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        background: "none",
        border: "none",
        padding: "10px 4px",
        cursor: "pointer",
        color: colors.text,
        fontSize: 12.5,
        fontWeight: 600,
        textAlign: "center",
      }}
    >
      <span style={{ width: 46, height: 46, borderRadius: "50%", background: colors.panel, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <ChatIcon size={19} />
      </span>
      {label}
    </button>
  );
}

function PreviewCard({ data }: { data: ShareData }) {
  return (
    <div style={{ display: "flex", gap: 12, background: colors.panel, borderRadius: radius.card, padding: 12, marginBottom: 18 }}>
      {data.image !== undefined && (
        <Photo src={data.image ?? undefined} alt={data.title} ph={colors.surface} style={{ width: 64, height: 64, borderRadius: 10, overflow: "hidden", flex: "none" }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.title}</div>
        <div style={{ fontSize: 12.5, color: colors.mutedLight, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{data.description}</div>
        {data.host?.name && <div style={{ fontSize: 11.5, color: colors.faint, marginTop: 4 }}>Hosted by {data.host.name}{data.host.verified ? " · Verified" : ""}</div>}
      </div>
    </div>
  );
}

function ShareToCirclePane({ data, onDone, onBack }: { data: ShareData; onDone: () => void; onBack: () => void }) {
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("Anyone interested in this?");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchMyCircles().then(setCircles).catch(() => setCircles([]));
  }, []);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      // shareToCircle's own endpoint already logs share_to_circle server-side
      // (with the circleId attached) — no duplicate client-side event here.
      await shareToCircle(selected, data.entityType, data.entityId, message.trim() || undefined);
      setDone(true);
      setTimeout(onDone, 900);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.greenText, fontSize: 14, fontWeight: 700, padding: "20px 0" }}>
        <CheckIcon size={16} /> Shared with your Circle
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, marginBottom: 14, color: colors.mutedLight, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
        <ChevronLeftIcon size={14} /> Back
      </button>
      {circles === null ? (
        <PageSpinner />
      ) : circles.length === 0 ? (
        <p style={{ fontSize: 13.5, color: colors.mutedLight }}>You're not in any Circles yet.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", marginBottom: 14 }}>
            {circles.map((c) => (
              <label
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 10px",
                  borderRadius: radius.control,
                  border: `1px solid ${selected === c.id ? colors.green : colors.border}`,
                  background: selected === c.id ? colors.greenBg : colors.surface,
                  cursor: "pointer",
                }}
              >
                <input type="radio" name="share-circle" checked={selected === c.id} onChange={() => setSelected(c.id)} style={{ margin: 0 }} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</span>
              </label>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Add a message"
            style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "8px 10px", fontSize: 13.5, marginBottom: 12, resize: "vertical", boxSizing: "border-box" }}
          />
          <Button full onClick={submit} disabled={!selected || busy}>
            {busy ? "Sharing…" : "Share to Circle"}
          </Button>
        </>
      )}
    </div>
  );
}

export function ShareSheet({ open, onClose, entityType, entityId }: { open: boolean; onClose: () => void; entityType: ShareEntityType; entityId: string }) {
  const { resident } = useGuest();
  const [data, setData] = useState<ShareData | null>(null);
  const [pane, setPane] = useState<"main" | "circle">("main");
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPane("main");
    setData(null);
    fetchShareData(entityType, entityId)
      .then(setData)
      .catch(() => setData(null));
    void logShareEvent("share_opened", entityType, entityId).catch(() => {});
  }, [open, entityType, entityId]);

  useEffect(() => {
    if (!qrOpen || !data || qrDataUrl) return;
    import("qrcode").then((QRCode) => QRCode.toDataURL(data.url, { width: 220, margin: 1 }).then(setQrDataUrl));
  }, [qrOpen, data, qrDataUrl]);

  const openChannel = (channel: ChannelKey) => {
    if (!data) return;
    void logShareEvent("share_channel_selected", entityType, entityId, channel).catch(() => {});
    const message = channel === "email" ? "" : buildShareMessage(data);
    const url = channelUrl(channel, message, data);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    void logShareEvent("share_completed", entityType, entityId, channel).catch(() => {});
  };

  const copyLink = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.url);
    setCopied(true);
    void logShareEvent("share_link_copied", entityType, entityId, "copy_link").catch(() => {});
    void logShareEvent("share_completed", entityType, entityId, "copy_link").catch(() => {});
    setTimeout(() => setCopied(false), 2000);
  };

  const nativeShare = async () => {
    if (!data || typeof navigator.share !== "function") return;
    void logShareEvent("share_channel_selected", entityType, entityId, "native").catch(() => {});
    try {
      await navigator.share({ title: data.title, text: buildShareMessage(data), url: data.url });
      void logShareEvent("share_completed", entityType, entityId, "native").catch(() => {});
    } catch {
      // user cancelled — not an error
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Share">
      {!data ? (
        <PageSpinner />
      ) : pane === "circle" ? (
        <ShareToCirclePane data={data} onDone={onClose} onBack={() => setPane("main")} />
      ) : (
        <>
          <PreviewCard data={data} />

          {data.privacy !== "public" && (
            <p style={{ fontSize: 12, color: colors.mutedLight, marginTop: -10, marginBottom: 16 }}>
              {data.privacy === "circle_only" ? "Only visible to Circle members you share this with." : "Only visible to people you invite."}
            </p>
          )}

          {resident && (
            <button
              onClick={() => setPane("circle")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                background: colors.greenBg,
                border: `1px solid ${colors.green}`,
                borderRadius: radius.control,
                padding: "12px 14px",
                marginBottom: 18,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 700,
                color: colors.greenText,
              }}
            >
              <UsersIcon size={17} /> Share to a Circle
            </button>
          )}

          <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.faint, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 8 }}>Send to</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 18 }}>
            <ChannelButton label="WhatsApp" onClick={() => openChannel("whatsapp")} />
            <ChannelButton label="Messages" onClick={() => openChannel("sms")} />
            <ChannelButton label="Telegram" onClick={() => openChannel("telegram")} />
            <ChannelButton label="Messenger" onClick={() => openChannel("messenger")} />
            <ChannelButton label="Facebook" onClick={() => openChannel("facebook")} />
            <ChannelButton label="Email" onClick={() => openChannel("email")} />
            {typeof navigator.share === "function" && <ChannelButton label="More" onClick={nativeShare} />}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={copyLink}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "11px 14px", cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}
            >
              {copied ? <CheckIcon size={16} style={{ color: colors.greenText }} /> : <ClipboardIcon size={16} />}
              {copied ? "Link copied" : "Copy link"}
            </button>
            <button
              onClick={() => setQrOpen((o) => !o)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "11px 14px", cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}
            >
              <ShareIcon size={16} /> {qrOpen ? "Hide QR code" : "Show QR code"}
            </button>
            {qrOpen && (
              <div style={{ textAlign: "center", padding: "12px 0" }}>
                {qrDataUrl ? <img src={qrDataUrl} alt="QR code to this link" width={180} height={180} style={{ borderRadius: 8 }} /> : <PageSpinner />}
                {qrDataUrl && (
                  <div>
                    <a href={qrDataUrl} download={`hellocircle-${entityType}-${entityId}.png`} style={{ fontSize: 12.5, color: colors.mutedLight, textDecoration: "underline" }}>
                      Download QR
                    </a>
                  </div>
                )}
              </div>
            )}
            <a
              href={`/api/share/${entityType}/${entityId}/card.png`}
              download={`hellocircle-${entityType}-${entityId}.png`}
              onClick={() => void logShareEvent("share_channel_selected", entityType, entityId, "download_image").catch(() => {})}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "11px 14px", cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: colors.text, textDecoration: "none" }}
            >
              <PhotoStackIcon size={16} /> Download share card image
            </a>
          </div>
        </>
      )}
    </Drawer>
  );
}
