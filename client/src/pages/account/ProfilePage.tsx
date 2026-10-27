import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Camera } from "lucide-react";
import { removeAvatar, updateResidentMe, uploadAvatar } from "../../api";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/Toast";
import { Avatar, Button, LoadErrorState, RowSkeleton, inputStyle } from "../../components/ui";
import { useGuest } from "../../GuestContext";
import { IRISH_COUNTY_COORDS } from "../../irishCounties";
import { accountHref } from "./accountSections";
import { AccountPage, AccountSection, InlineField, SettingRow, SettingRows, StatusTag, TextButton } from "./accountUi";
import { useResidentFull } from "./useResidentFull";

const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort();
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

function PhotoSection() {
  const { resident, refresh } = useGuest();
  const confirm = useConfirm();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !resident) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError(`That photo is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 4MB.`);
      return;
    }
    setError(null);
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      await uploadAvatar(file, resident.id);
      await refresh();
      toast.success("Profile photo updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your photo didn't upload. Try again.");
    } finally {
      setBusy(false);
      setPreview(null);
    }
  };

  const onRemove = async () => {
    const ok = await confirm({ title: "Remove your profile photo?", message: "Your initials will show instead.", confirmLabel: "Remove photo", tone: "danger" });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await removeAvatar();
      await refresh();
      toast.success("Profile photo removed");
    } catch {
      setError("Your photo wasn't removed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const hasPhoto = !!resident?.avatarUrl;
  return (
    <AccountSection title="Photo" description="Shown next to your name on Circles, Sessions and chats.">
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        {preview ? (
          <img src={preview} alt="New profile photo preview" style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover", opacity: 0.7 }} />
        ) : (
          <Avatar name={resident?.name || "?"} src={resident?.avatarUrl} size={88} />
        )}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Button variant="ghost" onClick={() => fileInput.current?.click()} disabled={busy} aria-busy={busy}>
              <Camera size={16} aria-hidden="true" /> {busy ? "Uploading…" : hasPhoto ? "Change photo" : "Add a photo"}
            </Button>
            {hasPhoto && !busy && <TextButton danger onClick={onRemove}>Remove</TextButton>}
          </div>
          <div className="acct-row-desc" style={{ marginTop: 8 }}>JPEG, PNG or WebP, up to 4MB.</div>
          {error && <p className="acct-field-error" role="alert">{error}</p>}
        </div>
        <input ref={fileInput} type="file" accept={PHOTO_TYPES.join(",")} onChange={onFile} hidden aria-hidden="true" tabIndex={-1} />
      </div>
    </AccountSection>
  );
}

export function ProfilePage() {
  const { resident, refresh } = useGuest();
  const toast = useToast();
  const { data, loading, failed, reload, patch } = useResidentFull();

  const saveField = async (field: "name" | "homeCounty", value: string) => {
    await updateResidentMe({ [field]: value.trim() });
    patch({ [field]: value.trim() });
    await refresh();
    toast.success(field === "name" ? "Name saved" : "Home county saved");
  };

  return (
    <AccountPage eyebrow="Account" title="Profile" lede="How you appear to hosts and the people you meet at activities." narrow>
      <PhotoSection />
      <AccountSection title="About you">
        {loading ? (
          <RowSkeleton />
        ) : failed || !data ? (
          <LoadErrorState title="We couldn't load your profile." onRetry={reload} />
        ) : (
          <SettingRows>
            <InlineField
              label="Name"
              description="Shown to hosts and other participants."
              display={data.name || "Not set"}
              empty={!data.name}
              initial={data.name}
              validate={(v) => (v.trim() ? (v.trim().length > 80 ? "Keep your name under 80 characters." : null) : "Enter your name.")}
              renderEditor={({ id, value, onChange, invalid, describedBy }) => (
                <input id={id} value={value} onChange={(e) => onChange(e.target.value)} autoFocus autoComplete="name" aria-invalid={invalid} aria-describedby={describedBy} style={inputStyle} />
              )}
              onSave={(v) => saveField("name", v)}
            />
            <InlineField
              label="Home county"
              description="Used to show you what's on nearby."
              display={data.homeCounty || "Not set"}
              empty={!data.homeCounty}
              initial={data.homeCounty}
              renderEditor={({ id, value, onChange }) => (
                <select id={id} value={value} onChange={(e) => onChange(e.target.value)} autoFocus style={inputStyle}>
                  <option value="">Not set</option>
                  {value && !COUNTIES.includes(value) && <option value={value}>{value}</option>}
                  {COUNTIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
              onSave={(v) => saveField("homeCounty", v)}
            />
            {data.hostStatus === "verified" && (
              <SettingRow
                stack
                label="Host bio"
                description={data.hostBio || "Not written yet"}
                control={<Link className="acct-text-btn" to={accountHref("hosting")}>Edit in Hosting</Link>}
              />
            )}
          </SettingRows>
        )}
      </AccountSection>
      <AccountSection title="Signing in">
        <SettingRows>
          <SettingRow
            stack
            label="Email"
            description="Used to sign in. Never shown to other participants."
            control={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="acct-row-value">{resident?.email}</span>
                {data && <StatusTag tone={data.emailVerified ? "ok" : "warn"}>{data.emailVerified ? "Verified" : "Not verified"}</StatusTag>}
              </span>
            }
          />
          <SettingRow
            label="Password, Google and email links"
            control={
              <Link className="acct-text-btn" to={accountHref("security")}>
                Sign-in & data <ArrowRight size={15} aria-hidden="true" />
              </Link>
            }
          />
        </SettingRows>
      </AccountSection>
    </AccountPage>
  );
}
