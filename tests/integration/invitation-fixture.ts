import { randomBytes, randomUUID } from "node:crypto";
import type { PlaywrightWorkerArgs } from "@playwright/test";
import { withActors } from "./authorization-fixture";
import { personas } from "./fixtures";

type Scope = Parameters<Parameters<typeof withActors>[2]>[0];
export async function withInvitation(playwright: PlaywrightWorkerArgs["playwright"], actors: string[], email: string | undefined,
  exercise: (f: Scope & { token: string; email: string; orgId: string; payload: Record<string, unknown> }) => Promise<void>) {
  await withActors(playwright, actors, async scope => {
    const recipient = email ?? `qa_accept_${randomUUID()}@example.test`;
    const [existing] = await scope.connection.query<any[]>("SELECT id FROM users WHERE email=?", [recipient]);
    const [owners] = await scope.connection.query<any[]>("SELECT org_id FROM users WHERE id=?", [personas.QA_VENDOR.id]);
    const token = randomBytes(32).toString("hex"), orgId = owners[0].org_id;
    scope.track("org_invites", "token", token);
    await scope.connection.execute("INSERT INTO org_invites (token,org_id,email,platform_role,expires_at) VALUES (?,?,?,'read_only_analyst',DATE_ADD(NOW(),INTERVAL 1 DAY))", [token,orgId,recipient]);
    try {
      await exercise({ ...scope, token, email: recipient, orgId, payload: { token, name: "QA intended recipient", password: randomBytes(32).toString("hex"), termsAccepted: true } });
    } finally {
      if (!existing.length) {
        const [created] = await scope.connection.query<any[]>("SELECT id FROM users WHERE email=?", [recipient]);
        for (const row of created) { scope.track("users", "id", row.id); scope.track("sessions", "user_id", row.id); }
      }
    }
  });
}
