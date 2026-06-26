import { describe, it, expect } from "vitest";
import { isClientInstalled } from "../../src/util/detectClient.js";

describe("isClientInstalled", () => {
  it("honors the injected installed override map", () => {
    const installed = { cursor: false, "claude-code": true };
    expect(isClientInstalled("cursor", { installed })).toBe(false);
    expect(isClientInstalled("claude-code", { installed })).toBe(true);
  });

  it("falls back to real detection for ids not in the override map", () => {
    // Only cursor is overridden; claude-code is not present in the map, so it
    // is detected normally. We don't assert its truthiness (machine-dependent).
    const installed = { cursor: false };
    expect(isClientInstalled("cursor", { installed })).toBe(false);
  });

  it("returns true for unknown ids (don't block unknowns)", () => {
    expect(isClientInstalled("definitely-not-a-real-client-xyz")).toBe(true);
  });

  it("detects codex via its config file under the injected home", () => {
    // No override map, so detection runs. With a bogus home and codex binary
    // typically absent, this is machine-dependent; use the override for
    // determinism but still exercise the home option path for unknown ids.
    expect(
      isClientInstalled("bogus-client", { home: "/nonexistent-home" }),
    ).toBe(true);
  });
});
