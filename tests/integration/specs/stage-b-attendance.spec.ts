import { randomUUID } from "node:crypto";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";

test("STAGE-B-CHILD: foreign session attendance must not be exposed under an owned programme", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async ({ actors, connection, track, snapshot }) => {
    const [orgs] = await connection.query<any[]>("SELECT org_id FROM users WHERE id IN (?,?)", [personas.QA_VENDOR.id,personas.QA_VENDOR_B.id]);
    expect(orgs.length).toBe(2);
    expect(!!orgs[0].org_id && !!orgs[1].org_id && orgs[0].org_id !== orgs[1].org_id).toBe(true);
    const programs: string[] = [];
    for (const name of ["QA_VENDOR", "QA_VENDOR_B"]) {
      const centreResponse = await actors[name].post("/api/vendor/centres", { data: { name: `QA attendance ${randomUUID()}`, paymentMethod: "cash" } });
      expect(centreResponse.status()).toBe(201);
      const centre = (await centreResponse.json()).id;
      track("centres", "id", centre); track("rooms", "centre_id", centre); track("audit_log", "object_id", centre);
      const response = await actors[name].post("/api/vendor/programs", { data: { listingType: "centre", listingId: centre, title: "QA private attendance programme", description: "Synthetic authorization fixture" } });
      expect(response.status()).toBe(201);
      const program = (await response.json()).id;
      programs.push(program); track("programs", "id", program); track("program_sessions", "program_id", program);
    }
    const created = await actors.QA_VENDOR.post(`/api/vendor/programs/${programs[0]}/sessions`, { data: { date: "2030-06-20", time: "12:00" } });
    expect(created.status()).toBe(201);
    const session = (await created.json()).id;
    // Unpaid synthetic enrollment: no checkout, payment creation or provider call.
    const [enrollment] = await connection.execute<any>("INSERT INTO program_enrollments (ref,program_id,client_id,participant_name,email,total_cents,payment_status) VALUES (?,?,?,'QA synthetic participant','qa_attendance@example.test',0,'pending')", [randomUUID(),programs[0],randomUUID()]);
    track("program_enrollments", "id", enrollment.insertId);
    const ref = `${session}:${enrollment.insertId}`;
    track("attendance", "ref", ref);
    await connection.execute("INSERT INTO attendance (kind,ref,checked_in_by,status) VALUES ('program_session',?,?,'present')", [ref,personas.QA_VENDOR.id]);
    const invariants = await Promise.all([
      snapshot("SELECT * FROM programs WHERE id IN (?,?) ORDER BY id", programs),
      snapshot("SELECT * FROM program_sessions WHERE id=?", [session]),
      snapshot("SELECT * FROM program_enrollments WHERE id=?", [enrollment.insertId]),
      snapshot("SELECT * FROM attendance WHERE ref=?", [ref]),
    ]);
    const canonical = `/api/vendor/programs/${programs[0]}/sessions/${session}/attendance`;
    const own = await actors.QA_VENDOR.get(canonical);
    expect(own.status()).toBe(200);
    const matches = (rows: any) => Array.isArray(rows) && rows.some(row => row.enrollmentId === String(enrollment.insertId) && row.status === "present");
    expect(matches(await own.json())).toBe(true);
    const direct = await actors.QA_VENDOR_B.get(canonical);
    expect(direct.status()).toBe(403);
    const substituted = await actors.QA_VENDOR_B.get(`/api/vendor/programs/${programs[1]}/sessions/${session}/attendance`);
    const exposed = matches(await substituted.json());
    for (const unchanged of invariants) await unchanged();
    await evidence("stage-b-attendance", { separateOrganisations: true, ownerStatus: own.status(), foreignParentStatus: direct.status(), substitutedParentStatus: substituted.status(), foreignAttendanceDisclosed: exposed, scopedDatabaseUnchanged: true, paymentUsed: false });
    expect(exposed, "Owning a different programme must not grant foreign session attendance access").toBe(false);
  });
});
