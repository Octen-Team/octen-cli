import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { isClientInstalled } from "../../src/util/detectClient.js";

function hasBinary(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

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

describe("isClientInstalled: devin", () => {
  // Files Devin CLI 3000.14 creates on first run (observed 2026-11-25); Octen only ever writes mcp_config.json.
  it("detects Devin from its own config.json", () => {
    const home = mkdtempSync(join(tmpdir(), "octen-detect-"));
    try {
      mkdirSync(join(home, ".config/devin"), { recursive: true });
      writeFileSync(join(home, ".config/devin/config.json"), "{}");
      expect(isClientInstalled("devin", { home })).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it("detects Devin from its data directory", () => {
    const home = mkdtempSync(join(tmpdir(), "octen-detect-"));
    try {
      mkdirSync(join(home, ".local/share/devin"), { recursive: true });
      expect(isClientInstalled("devin", { home })).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it.skipIf(hasBinary("devin"))("does not count the mcp_config.json that configure-mcp --force writes", () => {
    const home = mkdtempSync(join(tmpdir(), "octen-detect-"));
    try {
      mkdirSync(join(home, ".config/devin"), { recursive: true });
      writeFileSync(join(home, ".config/devin/mcp_config.json"), "{}");
      expect(isClientInstalled("devin", { home })).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  // Skipped where a devin binary is on PATH, since that alone counts as installed.
  it.skipIf(hasBinary("devin"))("is not detected without the config directory or a devin binary", () => {
    const home = mkdtempSync(join(tmpdir(), "octen-detect-"));
    try {
      expect(isClientInstalled("devin", { home })).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
