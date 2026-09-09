import os from "node:os";
import { spawn } from "node:child_process";
import type { Command } from "commander";
import { login } from "../auth/login.js";
import { CREDENTIALS_VERSION, credentialsPath, writeCredentials } from "../auth/store.js";
import { parseIntOpt } from "./utils.js";

export interface LoginInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir(). */
  home?: string;
  /** Injected env (for testing); defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Injected fetch (for testing); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected browser opener (for testing); defaults to spawning the OS opener. */
  openBrowser?: (url: string) => void;
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
 * Fire-and-forget browser launch: `detached: true` + `stdio: "ignore"` +
 * `unref()` so the CLI never waits on the browser process, and a slow or
 * hung browser can't hang the login. A synchronous spawn failure is left to
 * the caller (`src/auth/login.ts` falls back to printing the URL).
 */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [cmd, args] = browserCommand(platform, url);
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export function registerLogin(program: Command, internal: LoginInternalOpts = {}): void {
  program
    .command("login")
    .description("Log in via your browser and store the resulting API key")
    .option("--port <n>", "pin the loopback callback port (for ssh -L forwarding)", parseIntOpt("--port"))
    .option("--no-browser", "print the authorize URL instead of opening it")
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const g = command.optsWithGlobals() as { apiKey?: string; port?: number; browser?: boolean };
      const home = internal.home ?? os.homedir();
      const env = internal.env ?? process.env;

      // --api-key is a separate branch: no server, no network request, just
      // write the file and return (design §6.6).
      if (g.apiKey) {
        writeCredentials(home, { version: CREDENTIALS_VERSION, source: "api-key", apiKey: g.apiKey });
        process.stdout.write("API key saved.\n");
        return;
      }

      const creds = await login({
        home,
        env,
        fetchImpl: internal.fetchImpl,
        openBrowser: internal.openBrowser ?? ((url: string) => openBrowser(url)),
        noBrowser: g.browser === false,
        port: g.port,
      });

      process.stdout.write(
        `Logged in${creds.source === "login" && creds.accountId ? ` as ${creds.accountId}` : ""}. Credentials saved to ${credentialsPath(home)}\n`,
      );
    });
}
