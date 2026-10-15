import type { ReactNode } from "react";
import { useAuth } from "../../AuthContext";
import { useGuest } from "../../GuestContext";
import { PartnerWorkspace } from "./PartnerWorkspace";
import { HostWorkspace } from "./HostWorkspace";

/** Pages shared by the partner and host workspaces (Pro, reward history):
 * rendered inside the matching workspace shell under Earnings. Signed-out
 * visitors get a plain page, which shows its own sign-in prompt. */
export function ScopedWorkspace({ scope, title, subtitle, children }: { scope: "vendor" | "host"; title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { user } = useAuth();
  const { resident } = useGuest();
  if (scope === "vendor" && user?.role === "vendor" && user.status === "approved") {
    return (
      <PartnerWorkspace user={user} active="earnings" title={title} subtitle={subtitle}>
        {children}
      </PartnerWorkspace>
    );
  }
  if (scope === "host" && resident) {
    return (
      <HostWorkspace resident={resident} active="earnings" title={title} subtitle={subtitle}>
        {children}
      </HostWorkspace>
    );
  }
  return (
    <section className="section-pad" style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px 64px" }}>
      <h1 style={{ fontSize: "clamp(28px, 3vw, 40px)", margin: "6px 0 12px" }}>{title}</h1>
      {children}
    </section>
  );
}
