import { randomUUID } from "node:crypto";
import type { PlaywrightWorkerArgs } from "@playwright/test";
import { withActors } from "./authorization-fixture";
import { expect, personas } from "./fixtures";

type Scope = Parameters<Parameters<typeof withActors>[2]>[0];
export async function withProgrammePairs(playwright: PlaywrightWorkerArgs["playwright"], exercise: (f: Scope & {
  entries: { role: string; program: string; session: string; enrollment: number; ref: string }[];
}) => Promise<void>) {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B", "GUEST"], async f => {
    const [orgs] = await f.connection.query<any[]>("SELECT org_id FROM users WHERE id IN (?,?)", [personas.QA_VENDOR.id,personas.QA_VENDOR_B.id]);
    expect(orgs.length === 2 && !!orgs[0].org_id && !!orgs[1].org_id && orgs[0].org_id !== orgs[1].org_id).toBe(true);
    const entries = [];
    for (const role of ["QA_VENDOR", "QA_VENDOR_B"]) {
      const centreResponse = await f.actors[role].post("/api/vendor/centres", { data: { name: `QA relationship ${randomUUID()}`, paymentMethod: "cash" } });
      expect(centreResponse.status()).toBe(201);
      const centre = (await centreResponse.json()).id;
      for (const [table,column] of [["centres","id"],["rooms","centre_id"],["centre_amenities","centre_id"],["centre_images","centre_id"],["audit_log","object_id"]]) f.track(table,column,centre);
      const programResponse = await f.actors[role].post("/api/vendor/programs", { data: { listingType: "centre", listingId: centre, title: "QA scoped programme", description: "Synthetic authorization only" } });
      expect(programResponse.status()).toBe(201);
      const program = (await programResponse.json()).id;
      f.track("programs","id",program); f.track("program_sessions","program_id",program);
      const sessionResponse = await f.actors[role].post(`/api/vendor/programs/${program}/sessions`, { data: { date: "2030-06-20", time: "12:00" } });
      expect(sessionResponse.status()).toBe(201);
      const session = (await sessionResponse.json()).id;
      const [insert] = await f.connection.execute<any>("INSERT INTO program_enrollments (ref,program_id,client_id,participant_name,email,total_cents,payment_status) VALUES (?,?,?,'QA synthetic participant','qa_relationship@example.test',0,'pending')", [randomUUID(),program,randomUUID()]);
      const enrollment = Number(insert.insertId), ref = `${session}:${enrollment}`;
      f.track("program_enrollments","id",enrollment); f.track("attendance","ref",ref);
      const attendance = await f.actors[role].post(`/api/vendor/program-sessions/${session}/attendance/${enrollment}`, { data: { status: "present" } });
      expect(attendance.status()).toBe(200);
      entries.push({role,program,session,enrollment,ref});
    }
    await exercise({...f,entries});
  });
}
