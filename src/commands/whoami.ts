import os from "node:os";
import type { Command } from "commander";
import { readCredentials } from "../auth/store.js";
import { OctenAuthError } from "../api/errors.js";
import { chooseMode, emit } from "../output/render.js";
import { renderWhoami, type WhoamiData } from "../output/pretty/whoami.js";

export interface WhoamiInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir(). */
  home?: string;
}

const NOT_LOGGED_IN_MESSAGE =
  "Not logged in (no local credential file). Run `octen login`, or `octen login --api-key <key>`.";

/**
 * `octen whoami` — show the locally stored credential. Design §6.6: this
 * reads only the local file and makes zero network requests. There is
 * deliberately no `--verify`: under F3 there is no short-lived state to
 * verify, and a request would only prove the key works right now, which
 * `octen search` already shows.
 */
export function registerWhoami(program: Command, internal: WhoamiInternalOpts = {}): void {
  program
    .command("whoami")
    .description("Show the locally stored credential (reads only the local file, no network request)")
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const g = command.optsWithGlobals() as { json?: boolean; pretty?: boolean };
      const home = internal.home ?? os.homedir();
      const creds = readCredentials(home);

      if (!creds) {
        throw new OctenAuthError(NOT_LOGGED_IN_MESSAGE);
      }

      const data: WhoamiData =
        creds.source === "api-key"
          ? { loggedIn: true, source: "api-key" }
          : {
              loggedIn: true,
              source: "login",
              grantId: creds.grantId,
              ...(creds.accountId !== undefined ? { accountId: creds.accountId } : {}),
              ...(creds.accountType !== undefined ? { accountType: creds.accountType } : {}),
              apiKeyExpiresAt: creds.apiKeyExpiresAt,
            };

      emit(data, chooseMode(g, process.stdout.isTTY ?? false), renderWhoami);
    });
}
