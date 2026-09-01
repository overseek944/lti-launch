import { describe, expect, it } from "vitest";
import { CHALLENGES, isSolved, pointsMatched, scoreSubmission, MAX_SCORE } from "../src/activity/definition.js";

describe("activity scoring", () => {
  it("accepts the exact answer", () => {
    for (const challenge of CHALLENGES) {
      expect(isSolved(challenge, challenge.answer.m, challenge.answer.b)).toBe(true);
    }
  });

  it("accepts an answer within tolerance", () => {
    const c = CHALLENGES[0]!;
    expect(isSolved(c, c.answer.m + 0.01, c.answer.b)).toBe(true);
  });

  it("rejects an answer outside tolerance", () => {
    const c = CHALLENGES[0]!;
    expect(isSolved(c, c.answer.m + 0.5, c.answer.b)).toBe(false);
  });

  it("reports partial progress, which the live region announces", () => {
    const c = CHALLENGES[0]!;
    // Correct intercept, wrong slope: passes through (0,1) only.
    expect(pointsMatched(c, 99, c.answer.b)).toBe(1);
  });

  it("scores server side and never trusts a claimed score", () => {
    const all = CHALLENGES.map((c) => ({ challengeId: c.id, m: c.answer.m, b: c.answer.b }));
    expect(scoreSubmission(all).score).toBe(MAX_SCORE);
    expect(scoreSubmission([]).score).toBe(0);
    // A fabricated challenge id contributes nothing.
    expect(scoreSubmission([{ challengeId: "not-real", m: 1, b: 1 }]).score).toBe(0);
  });

  it("publishes MathML for every equation, so a screen reader reads it", () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.equationMathml).toContain("<math");
      expect(challenge.equationMathml).toContain("MathML");
    }
  });
});
