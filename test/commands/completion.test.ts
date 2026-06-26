import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    // self-initializes compinit so a bare source/eval works without extra setup
    expect(out).toContain("autoload -Uz compinit");
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

  it("--install appends an idempotent eval line to ~/.zshrc under injected home", async () => {
    const home = mkdtempSync(join(tmpdir(), "octen-comp-"));
    try {
      const make = () => {
        const prog = new Command();
        prog.name("octen").exitOverride();
        registerCompletion(prog, { home });
        return prog;
      };
      await make().parseAsync(["node", "octen", "completion", "zsh", "--install"]);
      const rc = join(home, ".zshrc");
      const evalLine = 'eval "$(octen completion zsh)"';
      expect(readFileSync(rc, "utf8")).toContain(evalLine);
      // Idempotent: a second install does not duplicate the line.
      await make().parseAsync(["node", "octen", "completion", "zsh", "--install"]);
      const occurrences = readFileSync(rc, "utf8").split(evalLine).length - 1;
      expect(occurrences).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("--install writes fish completion into the completions dir", async () => {
    const home = mkdtempSync(join(tmpdir(), "octen-comp-"));
    try {
      const prog = new Command();
      prog.name("octen").exitOverride();
      registerCompletion(prog, { home });
      await prog.parseAsync(["node", "octen", "completion", "fish", "--install"]);
      const file = join(home, ".config/fish/completions/octen.fish");
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toContain("complete -c octen");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
