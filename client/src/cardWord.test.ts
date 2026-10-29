import { describe, expect, it } from "vitest";
import { cardWord } from "./cardWord";

describe("cardWord", () => {
  it("prefers a chosen type, then the subcategory, then the category", () => {
    expect(cardWord({ name: "Racket sports", sub: "Badminton" }, "Activity", "Tennis")).toBe("Tennis");
    expect(cardWord({ name: "Racket sports", sub: "Badminton" }, "Activity")).toBe("Badminton");
    expect(cardWord({ name: "Racket sports", sub: null }, "Activity")).toBe("Racket sports");
  });
  it("shortens a two-part category name to its first part", () => {
    expect(cardWord({ name: "Outdoors & adventure", sub: null }, "Adventure")).toBe("Outdoors");
    expect(cardWord({ name: "Arts, crafts", sub: null }, "Experience")).toBe("Arts");
  });
  it("falls back to the listing kind when there's no category", () => {
    expect(cardWord(null, "Programme")).toBe("Programme");
    expect(cardWord(undefined, "Volunteer", null)).toBe("Volunteer");
  });
});
