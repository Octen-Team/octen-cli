import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { OctenValidationError } from "../../src/api/errors.js";
import { registerSearch } from "../../src/commands/search.js";
import { registerFetch } from "../../src/commands/fetch.js";
import { registerChat } from "../../src/commands/chat.js";
import { registerEmbed } from "../../src/commands/embed.js";
import { registerVlEmbed } from "../../src/commands/vlEmbed.js";
import { registerConfigureMcp } from "../../src/commands/configureMcp.js";
import { registerConfigureSkills } from "../../src/commands/configureSkills.js";
import { registerReset } from "../../src/commands/reset.js";
import { registerCompletion } from "../../src/commands/completion.js";

function makeProgram() {
  const prog = new Command();
  prog
    .name("octen")
    .option("--api-key <key>", "Octen API key")
    .option("--base-url <url>", "API base URL")
    .option("--json", "raw JSON output")
    .option("--pretty", "human-readable output")
    .option("--no-color", "disable color")
    .exitOverride();

  registerReset(prog);
  registerConfigureMcp(prog);
  registerConfigureSkills(prog);
  registerSearch(prog);
  registerSearch(prog, "news");
  registerFetch(prog);
  registerChat(prog);
  registerEmbed(prog);
  registerVlEmbed(prog);
  // Register LAST, mirroring cli.ts.
  registerCompletion(prog);
  return prog;
}

describe("completion command", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function run(shell: string): Promise<string> {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "completion", shell]);
    return writeSpy.mock.calls.map((c) => String(c[0])).join("");
  }

  it("emits a valid bash completion script with subcommands and flags", async () => {
    const out = await run("bash");
    expect(out).toContain("complete -F _octen octen");
    expect(out).toContain("_octen()");
    // Subcommand names
    expect(out).toContain("search");
    expect(out).toContain("fetch");
    expect(out).toContain("configure-mcp");
    // Known per-subcommand flags
    expect(out).toContain("--count"); // from search
    expect(out).toContain("--full"); // from fetch
  });

  it("emits a non-empty zsh script containing subcommands", async () => {
    const out = await run("zsh");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("bashcompinit");
    expect(out).toContain("search");
    expect(out).toContain("fetch");
    expect(out).toContain("configure-mcp");
  });

  it("emits fish complete lines with subcommand names", async () => {
    const out = await run("fish");
    expect(out).toContain("complete -c octen");
    expect(out).toContain("search");
    expect(out).toContain("fetch");
    expect(out).toContain("configure-mcp");
    // fish uses -l for the bare long name (no leading dashes)
    expect(out).toContain("-l count");
  });

  it("rejects an unknown shell with OctenValidationError", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "completion", "powershell"]),
    ).rejects.toThrow(OctenValidationError);
  });
});
