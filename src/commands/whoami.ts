import os from "node:os";
import type { Command } from "commander";
import { readCredentials, type Credentials } from "../auth/store.js";
import { authIssuer, authResource } from "../auth/constants.js";
import { credentialIgnoredReason } from "../config/resolve.js";
import { chooseMode, emit } from "../output/render.js";
import {
  renderWhoami,
  type EffectiveKeySource,
  type WhoamiData,
  type WhoamiIgnoredReason,
} from "../output/pretty/whoami.js";

export interface WhoamiInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir(). */
  home?: string;
  /** Injected env (for testing); defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /**
   * Deliberately no `fetchImpl`: `whoami` makes zero network requests, and
   * the absence of the seam is what keeps that true structurally rather than
   * by convention. Adding one would make it possible — and then easy — for a
   * later change to slip a request into a command whose entire contract is
   * "this only reads a local file".
   */
}

/**
 * `octen whoami` — show the locally stored credential. This reads only the
 * local file and makes zero network requests.
 *
 * There is deliberately no `--verify`. The stored credential is a long-lived
 * API key with no short-lived state attached, so there is nothing local that
 * could have gone stale and needs checking against the server; a request
 * would only prove the key worked at that instant, which running any actual
 * command already demonstrates. A `--verify` flag would also turn the one
 * command a user reaches for while debugging broken connectivity into
 * another command that needs working connectivity.
 *
 * It also reports which of the three sources is *actually* in effect. The
 * two filters `resolveApiKey` applies — the flag/env short-circuit and the
 * issuer/resource comparison — are applied here too (the second by calling
 * `credentialIgnoredReason`, the very function `resolveApiKey` calls), so
 * `whoami` can never describe a credential that `octen search` would refuse
 * to use.
 */
export function registerWhoami(program: Command, internal: WhoamiInternalOpts = {}): void {
  program
    .command("whoami")
    .description("Show the locally stored credential (reads only the local file, no network request)")
    .action(async (_opts: Record<string, unknown>, command: Command) => {
      const g = command.optsWithGlobals() as { json?: boolean; pretty?: boolean; apiKey?: string };
      const home = internal.home ?? os.homedir();
      const env = internal.env ?? process.env;
      const mode = chooseMode(g, process.stdout.isTTY ?? false);

      // Step 1/2 of resolveApiKey: an explicit flag or env var wins before
      // the file is even read, so a stored credential behind either of them
      // is not the one any command would use.
      const shadow: WhoamiIgnoredReason | undefined = g.apiKey
        ? "flag-shadowed"
        : env.OCTEN_API_KEY
          ? "env-shadowed"
          : undefined;
      const shadowSource: EffectiveKeySource | undefined = g.apiKey
        ? "--api-key"
        : env.OCTEN_API_KEY
          ? "OCTEN_API_KEY"
          : undefined;

      // The comment above is the whole point, so honour it: when a flag or env
      // var already decided the outcome, the file is irrelevant and must not be
      // able to fail this command. `resolveApiKey` returns on that path without
      // touching disk, so `octen search` works with a corrupt credentials file
      // while `octen whoami` used to be the one command that exited 2 — and in
      // --json mode emitted nothing at all, which is worse than useless to the
      // scripts that read it.
      let creds: Credentials | undefined;
      try {
        creds = readCredentials(home);
      } catch (err) {
        if (!shadowSource) throw err;
        creds = undefined;
      }

      if (!creds) {
        const data: WhoamiData = { loggedIn: false, effectiveSource: shadowSource ?? "none" };
        emit(data, mode, renderWhoami);
        // Exit code tracks "is a key in effect", not "does a file exist".
        // It used to track the latter and was wrong in both directions: it
        // exited 0 while reporting effectiveSource "none" (every command would
        // fail), and exited 2 when an env key was working fine. That made
        // `octen whoami && octen search …` unreliable in both directions.
        if (!shadowSource) process.exitCode = 2;
        return;
      }

      // Only reached when nothing shadows the file — mirroring resolveApiKey,
      // which never parses OCTEN_AUTH_* on the flag/env path either.
      const mismatch = shadow ? undefined : credentialIgnoredReason(creds, env);
      const ignoredReason = shadow ?? mismatch;
      const inEffect = ignoredReason === undefined;
      const effectiveSource: EffectiveKeySource =
        shadowSource ?? (inEffect ? "credentials-file" : "none");

      const effect = {
        loggedIn: true as const,
        effectiveSource,
        inEffect,
        ...(ignoredReason !== undefined ? { ignoredReason } : {}),
        ...(mismatch === "issuer-mismatch" ? { expectedIssuer: authIssuer(env) } : {}),
        ...(mismatch === "resource-mismatch" ? { expectedResource: authResource(env) } : {}),
      };

      const data: WhoamiData =
        creds.source === "api-key"
          ? { ...effect, source: "api-key" }
          : {
              ...effect,
              source: "login",
              issuer: creds.issuer,
              resource: creds.resource,
              grantId: creds.grantId,
              ...(creds.accountId !== undefined ? { accountId: creds.accountId } : {}),
              ...(creds.accountType !== undefined ? { accountType: creds.accountType } : {}),
              apiKeyExpiresAt: creds.apiKeyExpiresAt,
            };

      emit(data, mode, renderWhoami);
      // Same rule as the no-credential branch: "none" means every command would
      // fail, so it must not exit 0. A credential that exists but is shadowed
      // or belongs to another environment is exactly that case.
      if (effectiveSource === "none") process.exitCode = 2;
    });
}
