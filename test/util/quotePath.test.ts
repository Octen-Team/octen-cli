import { describe, it, expect } from "vitest";
import { quotePath } from "../../src/util/quotePath.js";

describe("quotePath", () => {
  it("leaves space-free paths unchanged", () => {
    expect(quotePath("/Users/dorian/.cursor/skills")).toBe(
      "/Users/dorian/.cursor/skills",
    );
  });

  it("single-quotes paths with spaces so they are copy-paste safe", () => {
    expect(
      quotePath(
        "/Users/dorian/Library/Application Support/Claude/claude_desktop_config.json",
      ),
    ).toBe(
      "'/Users/dorian/Library/Application Support/Claude/claude_desktop_config.json'",
    );
  });

  it("escapes embedded single quotes", () => {
    expect(quotePath("/tmp/a b/o'clock")).toBe("'/tmp/a b/o'\\''clock'");
  });
});
