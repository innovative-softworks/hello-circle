import { describe, expect, it } from "vitest";
import { buildRehostParams } from "./rehost";
import type { Game } from "./types";

// Host Experience Polish — pure-function coverage for the param-building
// logic extracted out of GameDetail.tsx's "Do it again" handler (now also
// shared by HostActivitiesTab.tsx's Duplicate/Host-again actions).

function baseGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "test-game-1",
    hostResidentId: "test-host",
    hostName: "Test Host",
    hostVerified: false,
    activityLabel: "Beginner Badminton",
    centreId: null,
    centreName: null,
    area: null,
    county: null,
    locationText: "",
    date: "2099-01-01",
    time: "18:00",
    skillLevel: "",
    capacity: 10,
    joined: 3,
    spotsLeft: 7,
    priceCents: null,
    visibility: "public",
    status: "open",
    createdAt: "2098-01-01T00:00:00.000Z",
    soloFriendly: false,
    bookingRef: null,
    minParticipants: null,
    confirmationDeadline: null,
    imageUrl: null,
    description: null,
    durationMinutes: null,
    equipmentNeeded: null,
    minAge: null,
    surfaceType: "",
    indoorOutdoor: "",
    meetingInstructions: null,
    cancellationPolicy: null,
    ...overrides,
  } as Game;
}

describe("buildRehostParams", () => {
  it("always carries the activity label and capacity", () => {
    const params = buildRehostParams(baseGame());
    expect(params.get("activity")).toBe("Beginner Badminton");
    expect(params.get("capacity")).toBe("10");
  });

  it("never carries date or time — a re-host always needs a new date", () => {
    const params = buildRehostParams(baseGame());
    expect(params.has("date")).toBe(false);
    expect(params.has("time")).toBe(false);
  });

  it("prefers centreId over locationText when both could apply", () => {
    const params = buildRehostParams(baseGame({ centreId: "centre-1", locationText: "The Park" }));
    expect(params.get("centreId")).toBe("centre-1");
    expect(params.has("locationText")).toBe(false);
  });

  it("falls back to locationText when there's no centre", () => {
    const params = buildRehostParams(baseGame({ centreId: null, locationText: "The Park" }));
    expect(params.get("locationText")).toBe("The Park");
  });

  it("omits optional fields that are unset rather than sending empty strings", () => {
    const params = buildRehostParams(baseGame());
    expect(params.has("priceCents")).toBe(false);
    expect(params.has("skillLevel")).toBe(false);
    expect(params.has("description")).toBe(false);
  });

  it("carries every optional field when set", () => {
    const params = buildRehostParams(
      baseGame({
        priceCents: 1500,
        skillLevel: "beginner",
        description: "A friendly game",
        durationMinutes: 90,
        equipmentNeeded: "Racket",
        minAge: 16,
        surfaceType: "indoor",
        indoorOutdoor: "indoor",
        meetingInstructions: "Meet at reception",
        cancellationPolicy: "24h notice",
      })
    );
    expect(params.get("priceCents")).toBe("1500");
    expect(params.get("skillLevel")).toBe("beginner");
    expect(params.get("description")).toBe("A friendly game");
    expect(params.get("durationMinutes")).toBe("90");
    expect(params.get("equipmentNeeded")).toBe("Racket");
    expect(params.get("minAge")).toBe("16");
    expect(params.get("surfaceType")).toBe("indoor");
    expect(params.get("indoorOutdoor")).toBe("indoor");
    expect(params.get("meetingInstructions")).toBe("Meet at reception");
    expect(params.get("cancellationPolicy")).toBe("24h notice");
  });
});
