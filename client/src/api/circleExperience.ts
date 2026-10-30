import type { CircleFirstTimeGuide, CircleFreeDaysView, CircleVisitorView, CircleFreeTimeView, CircleMemoriesView, CirclePulseView, CircleRestriction } from "../types";
import { request } from "./core";

// Circle Experience 2.0 — wrappers for server/src/routes/circleExperience.ts.
// Every one of these answers 404 while its circles.* switch is off; the
// client hides the entry points using useCircleFeatures() (circleFeatures.ts).

const c = (id: string) => `/circles/${encodeURIComponent(id)}`;

// --- Circle Pulse ---
export function fetchCirclePulse(circleId: string): Promise<CirclePulseView> {
  return request(`${c(circleId)}/pulse`);
}

export function saveCirclePulse(circleId: string, input: { interest: string; weekStart: string; slots: string[]; note?: string }): Promise<{ id: string; updated: boolean }> {
  return request(`${c(circleId)}/pulse`, { method: "POST", body: JSON.stringify(input) });
}

export function withdrawCirclePulse(circleId: string, pulseId: string): Promise<{ ok: boolean }> {
  return request(`${c(circleId)}/pulse/${encodeURIComponent(pulseId)}`, { method: "DELETE" });
}

// --- Free Time Match ---
// Organiser removals (2026-10-24): a wish goes as a whole; the people who
// added it are told. Polls are deleted with their votes.
export function removeCircleWish(circleId: string, weekStart: string, interestKey: string, reason?: string): Promise<{ ok: boolean; removed: number }> {
  return request(`${c(circleId)}/pulse-groups/${encodeURIComponent(weekStart)}/${encodeURIComponent(interestKey)}`, { method: "DELETE", body: JSON.stringify({ reason }) });
}

export function deleteCirclePoll(circleId: string, pollId: string): Promise<{ ok: boolean }> {
  return request(`${c(circleId)}/polls/${encodeURIComponent(pollId)}`, { method: "DELETE" });
}

// Circle Experience 4.0 — the visitor page's data (404 while the switch is off).
export function fetchCircleVisitor(circleId: string): Promise<CircleVisitorView> {
  return request(`${c(circleId)}/visitor`);
}

export function fetchCircleFreeDays(circleId: string): Promise<CircleFreeDaysView> {
  return request(`${c(circleId)}/free-days`);
}

export function fetchCircleFreeTime(circleId: string): Promise<CircleFreeTimeView> {
  return request(`${c(circleId)}/free-time`);
}

export function saveCircleFreeTime(circleId: string, weekStart: string, slots: string[]): Promise<{ ok: boolean; slots: string[] }> {
  return request(`${c(circleId)}/free-time/${weekStart}`, { method: "PUT", body: JSON.stringify({ slots }) });
}

export function withdrawCircleFreeTime(circleId: string, weekStart: string): Promise<{ ok: boolean }> {
  return request(`${c(circleId)}/free-time/${weekStart}`, { method: "DELETE" });
}

// --- Make It Happen ---
export function joinCirclePlanInterest(circleId: string, planId: string): Promise<{ ok: boolean; interestCount: number; interestedByMe: boolean }> {
  return request(`${c(circleId)}/plan-ideas/${encodeURIComponent(planId)}/interest`, { method: "POST" });
}

export function leaveCirclePlanInterest(circleId: string, planId: string): Promise<{ ok: boolean; interestCount: number; interestedByMe: boolean }> {
  return request(`${c(circleId)}/plan-ideas/${encodeURIComponent(planId)}/interest`, { method: "DELETE" });
}

// --- First-Time Friendly ---
export function dismissCircleWelcome(circleId: string): Promise<{ ok: boolean }> {
  return request(`${c(circleId)}/welcome/dismiss`, { method: "POST" });
}

export function fetchCircleFirstTime(circleId: string): Promise<CircleFirstTimeGuide> {
  return request(`${c(circleId)}/first-time`);
}

// --- Circle Memories ---
export function fetchCircleMemories(circleId: string): Promise<CircleMemoriesView> {
  return request(`${c(circleId)}/memories`);
}

export function addCircleMemory(
  circleId: string,
  input: { gameId: string; kind: "photo" | "reflection"; imageUrl?: string; caption?: string; body?: string; consent?: boolean }
): Promise<{ id: string }> {
  return request(`${c(circleId)}/memories`, { method: "POST", body: JSON.stringify(input) });
}

export function removeCircleMemory(circleId: string, memoryId: string): Promise<{ ok: boolean }> {
  return request(`${c(circleId)}/memories/${encodeURIComponent(memoryId)}`, { method: "DELETE" });
}

// --- D5: restrictions (organisers) ---
export function fetchCircleRestrictions(circleId: string): Promise<CircleRestriction[]> {
  return request(`${c(circleId)}/restrictions`);
}

export function liftCircleRestriction(circleId: string, residentId: string): Promise<{ ok: boolean }> {
  return request(`${c(circleId)}/restrictions/${encodeURIComponent(residentId)}/lift`, { method: "POST" });
}

// --- Admin: the five switches ---
export interface CircleFeatureSetting {
  key: string;
  group: "circles" | "experience" | "participation";
  label: string;
  description: string;
  enabled: boolean;
  /** Can't be switched on until the owner approves it. */
  locked?: boolean;
}

export function fetchCircleFeatureSettings(): Promise<{ features: CircleFeatureSetting[] }> {
  return request(`/admin/config/feature-switches`);
}

export function setCircleFeatureSetting(key: string, enabled: boolean): Promise<{ key: string; enabled: boolean }> {
  return request(`/admin/config/feature-switches/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ enabled }) });
}
