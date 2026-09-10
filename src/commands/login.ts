import os from "node:os";
import { spawn } from "node:child_process";
import type { Command } from "commander";
import { login } from "../auth/login.js";
import { CREDENTIALS_VERSION, credentialsPath, readCredentials, writeCredentials } from "../auth/store.js";
import { assertRange } from "../api/search.js";
import { parseIntOpt } from "./utils.js";

export interface LoginInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir(). */
  home?: string;
  /** Injected env (for testing); defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Injected fetch (for testing); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected browser opener (for testing); defaults to spawning the OS opener. */
  openBrowser?: (url: string, onFailure: (err: unknown) => void) => void;
}

/**
 * Build the argv for opening `url` in the platform's default browser. Pure
 * so each platform can be asserted without spawning anything.
 *
 * win32 is `rundll32 url.dll,FileProtocolHandler`, deliberately NOT
 * `cmd /c start`: `cmd` treats `&` as a command separator, and the
 * authorize URL's query string is full of them — the URL would arrive
 * truncated at the first `&`.
 */
export function browserCommand(platform: NodeJS.Platform, url: string): [cmd: string, args: string[]] {
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  if (platform === "linux") return ["xdg-open", [url]];
  return ["open", [url]];
}

/**
 * Spawn `cmd args` detached and ignored (`stdio: "ignore"`, `unref()`), so
 * the CLI never waits on the child. Reports a failure — sync OR async — via
 * `onFailure` instead of letting it propagate.
 *
 * This is the piece the original implementation got wrong: `spawn()` only
 * throws synchronously for a narrow set of argument-validation failures. A
 * missing binary (ENOENT — the common case: a headless box or a slim
 * container without `xdg-open`, exactly the environment this fallback
 * exists for) is reported asynchronously via the child's `'error'` event.
 * An EventEmitter with no `'error'` listener turns that into an uncaught
 * exception that kills the process — so the listener below is not optional.
 */
export function spawnDetached(cmd: string, args: string[], onFailure: (err: unknown) => void): void {
  let child;
  try {
    child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  } catch (err) {
    onFailure(err);
    return;
  }
  child.on("error", onFailure);
  child.unref();
}

/**
 * Open `url` in the platform's default browser. `onFailure` is called for
 * either a synchronous spawn error or (the common real-world case) an
 * asynchronous one, and the caller (`src/auth/login.ts`) routes both to the
 * same "print the URL instead" fallback.
 *
 * `resolveCommand` defaults to `browserCommand` and exists only so a test
 * can drive this real function — real `spawnDetached`, real `spawn`, real
 * `'error'` handling — against a guaranteed-nonexistent command, instead of
 * a real platform opener (`xdg-open`, `open`, `rundll32`) whose presence on
 * the machine running the suite is not something a test controls.
 */
export function openBrowser(
  url: string,
  onFailure: (err: unknown) => void,
  platform: NodeJS.Platform = process.platform,
  resolveCommand: (platform: NodeJS.Platform, url: string) => [string, string[]] = browserCommand,
): void {
  const [cmd, args] = resolveCommand(platform, url);
  spawnDetached(cmd, args, onFailure);
}

/**
 * A credential written while `OCTEN_API_KEY` is exported will never be read
 * by any command: `resolveApiKey` returns the env var before it touches the
 * file (src/config/resolve.ts:31-32). Reporting an unqualified "Logged in"
 * for that would tell the user a browser consent flow accomplished something
 * it did not. Warns on stderr only — stdout keeps carrying just the result,
 * so a script parsing stdout is unaffected — and never echoes either key.
 */
function warnIfEnvKeyShadows(env: NodeJS.ProcessEnv): void {
  if (!env.OCTEN_API_KEY) return;
  process.stderr.write(
    "warning: OCTEN_API_KEY is set in the environment and takes precedence over the stored " +
      "credential, so nothing will use the credential just saved. Unset OCTEN_API_KEY for this " +
      "login to take effect (`octen whoami` shows which source is in effect).\n",
  );
}

/**
 * `login --api-key` overwrites whatever is on disk. When that is a
 * `source: "login"` credential, the file being replaced is the only place
 * this machine records its `grantId` — the authorization stays listed in the
 * dashboard and, once the file is gone, nothing here can name it any more
 * — the same stranding `octen logout --local` prints the id to avoid.
 *
 * Costs zero network requests, which is what keeps this branch's contract
 * intact: `--api-key` exists so a machine with no browser and no outbound
 * access to the auth server can still be configured, so it must stay a pure
 * local file operation. Reading the old file before overwriting it is still
 * just a file read; the grant is deliberately NOT revoked here, which the
 * README's "Switching from a browser login to a pasted key" section
 * documents. An unreadable file is tolerated the way `octen logout` tolerates
 * it — there is no grantId to extract from it either way.
 */
function warnIfOverwritingLoginGrant(home: string): void {
  let existing;
  try {
    existing = readCredentials(home);
  } catch {
    return;
  }
  if (existing?.source !== "login") return;
  process.stderr.write(
    `warning: this replaces a browser login. Grant ${existing.grantId} was not revoked — ` +
      "`octen login --api-key` makes no network request. It can still mint a new credential " +
      "without a fresh consent screen; revoke it from the dashboard's authorization list if " +
      "you want to close it out. (Run `octen logout` first to revoke it properly.)\n",
  );
}

export function registerLogin(program: Command, internal: LoginInternalOpts = {}): void {
  program
    .command("login")
    .description("Log in via your browser and store the resulting API key")
    .option("--port <n>", "pin the loopback callback port (for ssh -L forwarding)", parseIntOpt("--port"))
    .option("--no-browser", "print the authorize URL instead of opening it")
    .addHelpText(
      "after",
      [
        "",
        "Environment:",
        "  OCTEN_AUTH_ISSUER    authorization server (default: https://auth.octen.ai)",
        "  OCTEN_AUTH_RESOURCE  token audience (default: https://cli.octen.ai)",
        "",
        "  Both are for local development only and must have no trailing slash. A stored",
        "  credential minted for a different issuer/resource pair is ignored (never used,",
        "  never deleted) — see the README's Auth section.",
        "",
      ].join("\n"),
    )
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const g = command.optsWithGlobals() as { apiKey?: string; port?: number; browser?: boolean };
      const home = internal.home ?? os.homedir();
      const env = internal.env ?? process.env;

      // --api-key is a separate branch: no loopback server, no network
      // request, just write the file and return. This is the path for CI, a
      // container, or any machine where a browser flow is not possible.
      if (g.apiKey) {
        warnIfOverwritingLoginGrant(home);
        writeCredentials(home, { version: CREDENTIALS_VERSION, source: "api-key", apiKey: g.apiKey });
        process.stdout.write("API key saved.\n");
        warnIfEnvKeyShadows(env);
        return;
      }

      // A bad --port names itself instead of surfacing as Node's own
      // ERR_SOCKET_BAD_PORT, or (for 0) silently picking a random port and
      // quietly defeating the `ssh -L` pinning the flag exists for.
      assertRange("--port", g.port, { min: 1, max: 65535 });

      const { credentials: creds, accountName } = await login({
        home,
        env,
        fetchImpl: internal.fetchImpl,
        openBrowser: internal.openBrowser ?? ((url, onFailure) => openBrowser(url, onFailure)),
        noBrowser: g.browser === false,
        port: g.port,
      });

      // Prefer the server's human-readable name ("Octen family", "Personal")
      // over the raw id, but keep the id as the fallback: the name is optional
      // on the wire, and it is absent both against a server that predates the
      // field and whenever the name could not be loaded.
      const account = creds.source === "login" ? (accountName ?? creds.accountId) : undefined;
      process.stdout.write(
        `Logged in${account ? ` as ${account}` : ""}. Credentials saved to ${credentialsPath(home)}\n`,
      );
      warnIfEnvKeyShadows(env);
    });
}
