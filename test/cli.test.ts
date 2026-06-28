import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runCli(args: string[]): string {
  return execFileSync("node", ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8" });
}

describe("cli", () => {
  it("prints version", () => {
    expect(runCli(["--version"]).trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("lists commands in help", () => {
    const help = runCli(["--help"]);
    for (const c of ["search", "extract", "chat", "embed", "vl-embed", "configure-mcp", "configure-skills", "reset"]) {
      expect(help).toContain(c);
    }
  });
});
