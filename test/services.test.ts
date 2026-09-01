import { describe, expect, it } from "vitest";
import { nextTimestamp } from "../src/lti/services.js";

describe("nextTimestamp", () => {
  it("uses now when there is no previous score", () => {
    const t = new Date(nextTimestamp(null)).getTime();
    expect(Math.abs(t - Date.now())).toBeLessThan(2000);
  });

  // The whole point. A retry that reuses the original timestamp is rejected by
  // the platform as stale, so the retry can never succeed.
  it("never returns a timestamp equal to or before the previous one", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const next = nextTimestamp(future);
    expect(new Date(next).getTime()).toBeGreaterThan(new Date(future).getTime());
  });

  it("is monotonic across repeated calls with its own output", () => {
    let previous: string | null = new Date(Date.now() + 5000).toISOString();
    for (let i = 0; i < 5; i++) {
      const next: string = nextTimestamp(previous);
      expect(new Date(next).getTime()).toBeGreaterThan(new Date(previous as string).getTime());
      previous = next;
    }
  });

  it("moves forward even when the previous timestamp is in the past", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(new Date(nextTimestamp(past)).getTime()).toBeGreaterThan(new Date(past).getTime());
  });
});
