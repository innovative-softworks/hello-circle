import type { Reporter, TestCase, TestResult, FullResult } from "@playwright/test/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadRun } from "./runtime";

/** No call logs, form values, cookies, request headers, tokens or raw errors in auth output. */
export default class AuthReporter implements Reporter {
  results: { title: string; status: string; durationMs: number; failureKind?: string }[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    const item = { title: test.title, status: result.status, durationMs: result.duration,
      ...(result.status === "passed" ? {} : { failureKind: result.status === "timedOut" ? "TIMEOUT — investigate test/application" : "ASSERTION/EXECUTION — inspect sanitized evidence" }) };
    this.results.push(item);
    console.log(`${result.status.toUpperCase()}: ${test.title}`);
    if (result.status !== "passed") {
      // File/line only: never emit exception messages or request/DB values.
      const locations = (result.error?.stack ?? "").match(/tests\/integration\/[a-zA-Z0-9_./-]+\.[cm]?ts:\d+:\d+/g);
      if (locations) console.log(`Failure locations: ${[...new Set(locations)].join(", ")}`);
    }
  }
  onError(error: { message?: string }) {
    const message = error.message ?? "";
    const categories = [
      [/webServer.*exited|Process from config\.webServer/i, "WEB_SERVER_EXIT"],
      [/already used|EADDRINUSE/i, "PORT_IN_USE"],
      [/timed out|timeout/i, "TIMEOUT"],
      [/ECONN|ENOTFOUND|socket/i, "CONNECTION"],
      [/Target.*closed|browser.*closed|SIGTERM|SIGKILL/i, "PROCESS_CLOSED"],
    ] as const;
    console.error(`QA runner error: ${categories.filter(([pattern]) => pattern.test(message)).map(([, label]) => label).join(", ") || "UNCLASSIFIED"}; raw diagnostics withheld to protect credentials.`);
  }
  onEnd(result: FullResult) {
    if (!this.results.length && result.status === "passed") {
      console.log("No tests selected in this batch; prior evidence retained.");
      return;
    }
    const { manifest } = loadRun();
    const directory = path.join(manifest.dataDir, "evidence");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const batch = process.env.QA_AUTH_BATCH;
    if (batch && !/^(lifecycle|booking|stripe|product)-[a-z0-9-]+$/.test(batch) && !["attendance-relations", "stage-b-attendance", "invitation-history", "invitation-binding", "invitation-consumption", "invitation-states", "invitation-hardening", "invitation-disclosure", "core", "collisions", "flows", "recovery", "boundaries", "ownership", "personal", "staff", "leakage", "visibility-adjacent", "logging-audit", "logging-adjacent", "recovery-audit", "recovery-adjacent",
      "stage-b-vendor", "stage-b-refund", "stage-b-org", "stage-b-host", "stage-b-circles", "stage-b-aggregation", "stage-b-admin", "stage-b-booking", "stage-b-personal", "stage-b-errors", "stage-b-media", "stage-b-visibility", "stage-b-visibility-2", "stage-b-findings", "stage-b-open", "hc-qa-010-015", "join-visibility",
      "account-link-race-closure", "account-link-closure", "chat-closure", "revocation-closure", "activity-invitation-closure", "hc-qa-002-core", "hc-qa-002-collisions", "hc-qa-002-flows", "hc-qa-002-recovery", "hc-qa-003", "hc-qa-004", "hc-qa-005", "hc-qa-006", "hc-qa-007", "hc-qa-008", "hc-qa-009"].includes(batch)) throw new Error("Invalid auth evidence batch.");
    const engine = ["firefox", "webkit"].includes(process.env.QA_BROWSER ?? "") ? `-${process.env.QA_BROWSER}` : "";
    writeFileSync(path.join(directory, batch ? `auth-results-${batch}${engine}.json` : "auth-results.json"), JSON.stringify({ status: result.status, tests: this.results }, null, 2), { mode: 0o600 });
    console.log(`Real-auth result: ${result.status}; ${this.results.filter((r) => r.status === "passed").length} passed; ${this.results.filter((r) => r.status !== "passed").length} not passed. Sanitized results retained under the current QA run.`);
  }
}
