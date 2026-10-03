import { randomUUID } from "node:crypto";
import { test, expect, personas } from "../fixtures";
import { withProgrammePairs } from "../programme-fixture";
import { evidence } from "../authorization-fixture";

test("ATTENDANCE-READ: parent-child matrix, descendant joins and read-only invariants", async ({ playwright }) => {
  await withProgrammePairs(playwright, async f => {
    const [a,b] = f.entries;
    // Model a historical malformed association. The read must not expose it.
    const corruptRef = `${a.session}:${b.enrollment}`;
    f.track("attendance","ref",corruptRef);
    await f.connection.execute("INSERT INTO attendance (kind,ref,checked_in_by,status) VALUES ('program_session',?,?,'present')", [corruptRef,personas.QA_VENDOR.id]);
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM programs WHERE id IN (?,?) ORDER BY id",[a.program,b.program]),
      f.snapshot("SELECT * FROM program_sessions WHERE id IN (?,?) ORDER BY id",[a.session,b.session]),
      f.snapshot("SELECT * FROM program_enrollments WHERE id IN (?,?) ORDER BY id",[a.enrollment,b.enrollment]),
      f.snapshot("SELECT * FROM attendance WHERE ref IN (?,?,?) ORDER BY ref",[a.ref,b.ref,corruptRef]),
      f.snapshot("SELECT * FROM sessions WHERE user_id IN (?,?) ORDER BY token",[personas.QA_VENDOR.id,personas.QA_VENDOR_B.id]),
      f.snapshot("SELECT * FROM audit_log WHERE actor_user_id IN (?,?) ORDER BY id",[personas.QA_VENDOR.id,personas.QA_VENDOR_B.id]),
    ]);
    const cases: [string,string,string,number][] = [
      [a.role,a.program,a.session,200],[b.role,b.program,b.session,200],
      [b.role,b.program,a.session,404],[a.role,a.program,b.session,404],
      [b.role,a.program,a.session,403],[a.role,b.program,a.session,403],
      [a.role,randomUUID(),a.session,403],[a.role,a.program,randomUUID(),404],
      [a.role,a.program,"%",404],["GUEST",a.program,a.session,401],
    ];
    for (const [role,program,session,status] of cases) {
      const response = await f.actors[role].get(`/api/vendor/programs/${program}/sessions/${encodeURIComponent(session)}/attendance`);
      expect(response.status()).toBe(status);
      const body = await response.json();
      if (status === 200) {
        const own = role === a.role ? a : b;
        expect(body.length).toBe(1);
        expect(body[0].enrollmentId === String(own.enrollment)).toBe(true);
      } else {
        expect(Array.isArray(body)).toBe(false);
        if (status === 404) expect(body).toEqual({error:"Session not found"});
        expect(body.enrollmentId === undefined && body.status === undefined).toBe(true);
      }
      for (const unchanged of invariants) await unchanged();
    }
  });
});

test("ATTENDANCE-WRITE: enrollment must belong to the authorized session programme", async ({ playwright }) => {
  await withProgrammePairs(playwright, async f => {
    const [a,b] = f.entries;
    const foreignRef = `${a.session}:${b.enrollment}`;
    f.track("attendance","ref",foreignRef);
    f.track("attendance","ref",`${a.session}:0`);
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM programs WHERE id IN (?,?) ORDER BY id",[a.program,b.program]),
      f.snapshot("SELECT * FROM program_sessions WHERE id IN (?,?) ORDER BY id",[a.session,b.session]),
      f.snapshot("SELECT * FROM program_enrollments WHERE id IN (?,?) ORDER BY id",[a.enrollment,b.enrollment]),
      f.snapshot("SELECT * FROM attendance WHERE ref IN (?,?,?,?) ORDER BY ref",[a.ref,b.ref,foreignRef,`${a.session}:0`]),
    ]);
    const response = await f.actors[a.role].post(`/api/vendor/program-sessions/${a.session}/attendance/${b.enrollment}`, { data: { status: "absent" } });
    const [rows] = await f.connection.query<any[]>("SELECT ref FROM attendance WHERE ref=?",[foreignRef]);
    await evidence("attendance-enrollment-boundary", { responseStatus: response.status(), invalidCrossProgrammeAssociationCreated: rows.length > 0, paymentUsed: false });
    expect(response.status(), "Foreign or nonexistent enrollment must be rejected").toBe(404);
    for (const unchanged of invariants) await unchanged();
    // Other programme's real session is denied even when both child IDs are valid.
    expect((await f.actors[a.role].post(`/api/vendor/program-sessions/${b.session}/attendance/${b.enrollment}`, { data: {status:"absent"} })).status()).toBe(403);
    // Invalid child IDs must not create orphan attendance either.
    expect((await f.actors[a.role].post(`/api/vendor/program-sessions/${a.session}/attendance/0`, { data: {status:"absent"} })).status()).toBe(404);
    for (const unchanged of invariants) await unchanged();
    // Correct child mutation remains functional; its other programme is unchanged.
    const foreign = await f.snapshot("SELECT * FROM attendance WHERE ref=?",[b.ref]);
    expect((await f.actors[a.role].post(`/api/vendor/program-sessions/${a.session}/attendance/${a.enrollment}`, { data: {status:"absent"} })).status()).toBe(200);
    const [own] = await f.connection.query<any[]>("SELECT status FROM attendance WHERE ref=?",[a.ref]);
    expect(own[0].status).toBe("absent"); await foreign();
  });
});

test("ATTENDANCE-SIBLINGS: enrollment cancellation and session deletion preserve foreign children", async ({ playwright }) => {
  await withProgrammePairs(playwright, async f => {
    const [a,b] = f.entries;
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM programs WHERE id IN (?,?) ORDER BY id",[a.program,b.program]),
      f.snapshot("SELECT * FROM program_sessions WHERE id IN (?,?) ORDER BY id",[a.session,b.session]),
      f.snapshot("SELECT * FROM program_enrollments WHERE id IN (?,?) ORDER BY id",[a.enrollment,b.enrollment]),
      f.snapshot("SELECT * FROM attendance WHERE ref IN (?,?) ORDER BY ref",[a.ref,b.ref]),
    ]);
    expect((await f.actors[a.role].post(`/api/vendor/programs/${a.program}/enrollments/${b.enrollment}/cancel`)).status()).toBe(404);
    expect((await f.actors[a.role].delete(`/api/vendor/programs/${a.program}/sessions/${b.session}`)).status()).toBe(200);
    expect((await f.actors[a.role].get(`/api/vendor/programs/${b.program}/enrollments`)).status()).toBe(403);
    for (const unchanged of invariants) await unchanged();
  });
});
