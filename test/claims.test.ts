import { describe, expect, it } from "vitest";
import { canGrade, resolveRole } from "../src/lti/claims.js";

const MEMBERSHIP = "http://purl.imsglobal.org/vocab/lis/v2/membership";
const INSTITUTION = "http://purl.imsglobal.org/vocab/lis/v2/institution/person";

describe("resolveRole", () => {
  it("recognises a membership instructor", () => {
    expect(resolveRole([`${MEMBERSHIP}#Instructor`])).toBe("instructor");
  });

  it("recognises an institution role, which some platforms send instead", () => {
    expect(resolveRole([`${INSTITUTION}#Student`])).toBe("learner");
  });

  it("takes the more privileged of several recognised roles", () => {
    expect(resolveRole([`${MEMBERSHIP}#Learner`, `${MEMBERSHIP}#Instructor`])).toBe("instructor");
  });

  it("treats a teaching assistant as an instructor", () => {
    expect(resolveRole([`${MEMBERSHIP}#TeachingAssistant`])).toBe("instructor");
  });

  // Least privilege on anything unrecognised, rather than guessing upward.
  it("falls back to unknown, not to learner or instructor", () => {
    expect(resolveRole([`${MEMBERSHIP}#Officer`])).toBe("unknown");
    expect(resolveRole([])).toBe("unknown");
    expect(resolveRole(undefined)).toBe("unknown");
    expect(resolveRole("not-an-array")).toBe("unknown");
  });

  it("never grants grading rights to an unknown or learner role", () => {
    expect(canGrade(resolveRole([]))).toBe(false);
    expect(canGrade(resolveRole([`${MEMBERSHIP}#Learner`]))).toBe(false);
    expect(canGrade(resolveRole([`${MEMBERSHIP}#Instructor`]))).toBe(true);
  });
});
