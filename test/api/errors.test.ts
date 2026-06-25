import { describe, it, expect } from "vitest";
import { OctenAuthError, OctenValidationError, OctenAPIError, exitCodeFor } from "../../src/api/errors.js";

describe("errors", () => {
  it("maps error classes to exit codes", () => {
    expect(exitCodeFor(new OctenAuthError("no key"))).toBe(2);
    expect(exitCodeFor(new OctenValidationError("bad"))).toBe(2);
    expect(exitCodeFor(new OctenAPIError("boom", 500))).toBe(1);
    expect(exitCodeFor(new Error("other"))).toBe(1);
  });
});
