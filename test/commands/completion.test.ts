import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { OctenValidationError } from "../../src/api/errors.js";
import { registerSearch } from "../../src/commands/search.js";
import { registerExtract } from "../../src/commands/extract.js";
import { registerChat } from "../../src/commands/chat.js";
import { registerEmbed } from "../../src/commands/embed.js";
import { registerVlEmbed } from "../../src/commands/vlEmbed.js";
import { registerConfigureMcp } from "../../src/commands/configureMcp.js";
import { registerConfigureSkills } from "../../src/commands/configureSkills.js";
import { registerReset } from "../../src/commands/reset.js";
import { registerCompletion } from "../../src/commands/completion.js";

function makeProgram(internal: { home?: string } = {}) {
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
  registerExtract(prog);
  registerChat(prog);
  registerEmbed(prog);
  registerVlEmbed(prog);
  // Register LAST, mirroring cli.ts.
  registerCompletion(prog, internal);
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
    expect(out).toContain("extract");
    expect(out).toContain("configure-mcp");
    // Known per-subcommand flags
    expect(out).toContain("--count"); // from search
    expect(out).toContain("--full"); // from extract
  });

  it("emits a non-empty zsh script containing subcommands", async () => {
    const out = await run("zsh");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("bashcompinit");
    // self-initializes compinit so a bare source/eval works without extra setup
    expect(out).toContain("autoload -Uz compinit");
    expect(out).toContain("search");
    expect(out).toContain("extract");
    expect(out).toContain("configure-mcp");
  });

  it("emits fish complete lines with subcommand names", async () => {
    const out = await run("fish");
    expect(out).toContain("complete -c octen");
    expect(out).toContain("search");
    expect(out).toContain("extract");
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

  it("--install (zsh) writes a native _octen file on fpath and a compinit block in ~/.zshrc", async () => {
    const home = mkdtempSync(join(tmpdir(), "octen-comp-"));
    try {
      const make = () => makeProgram({ home });
      await make().parseAsync(["node", "octen", "completion", "zsh", "--install"]);

      // Native completion function file lives in an fpath dir.
      const fn = join(home, ".octen/completions/_octen");
      expect(existsSync(fn)).toBe(true);
      const fnBody = readFileSync(fn, "utf8");
      expect(fnBody).toContain("#compdef octen");
      expect(fnBody).toContain("compadd --");
      expect(fnBody).toContain("search"); // subcommand
      expect(fnBody).toContain("--count"); // per-subcommand flag

      // ~/.zshrc gets the fpath + compinit block.
      const rc = join(home, ".zshrc");
      const rcBody = readFileSync(rc, "utf8");
      expect(rcBody).toContain("# >>> octen completion >>>");
      expect(rcBody).toContain('fpath=("$HOME/.octen/completions" $fpath)');
      expect(rcBody).toContain("autoload -Uz compinit && compinit");

      // Idempotent: a second install does not duplicate the block.
      await make().parseAsync(["node", "octen", "completion", "zsh", "--install"]);
      const blocks = readFileSync(rc, "utf8").split("# >>> octen completion >>>").length - 1;
      expect(blocks).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("--install (zsh) migrates a legacy eval line to the fpath block", async () => {
    const home = mkdtempSync(join(tmpdir(), "octen-comp-"));
    try {
      const rc = join(home, ".zshrc");
      writeFileSync(
        rc,
        '# user config\n\n# octen CLI completion\neval "$(octen completion zsh)"\n',
      );
      await makeProgram({ home }).parseAsync(["node", "octen", "completion", "zsh", "--install"]);

      const rcBody = readFileSync(rc, "utf8");
      expect(rcBody).not.toContain('eval "$(octen completion zsh)"');
      expect(rcBody).toContain("# >>> octen completion >>>");
      expect(rcBody).toContain("# user config"); // preserved unrelated lines
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("--install (bash) writes a native completion file into the bash-completion dir", async () => {
    const home = mkdtempSync(join(tmpdir(), "octen-comp-"));
    try {
      await makeProgram({ home }).parseAsync(["node", "octen", "completion", "bash", "--install"]);

      const file = join(home, ".local/share/bash-completion/completions/octen");
      expect(existsSync(file)).toBe(true);
      const body = readFileSync(file, "utf8");
      expect(body).toContain("complete -F _octen octen");
      expect(body).toContain("_octen()");
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
