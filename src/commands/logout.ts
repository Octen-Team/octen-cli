import os from "node:os";
import type { Command } from "commander";
import { readCredentials, deleteCredentials } from "../auth/store.js";
import { revokeCliGrant } from "../auth/revoke.js";
import { OctenNetworkError } from "../api/errors.js";

export interface LogoutInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir(). */
  home?: string;
  /**
   * Injected fetch (for testing); defaults to global fetch. Never invoked
   * for a `source: "api-key"` credential (no grant exists to revoke), when
   * `--local` is passed, or when the stored file is unreadable (design
   * §6.6) — all three branches make zero network requests.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Mirrors the exact fixed message `src/auth/revoke.ts` throws for a 400
 * response (`revoke.ts:70`) — the grant is already gone server-side
 * (already revoked, or never existed), so logout's goal is already met.
 * This is a deliberate string-match coupling to that module's copy rather
 * than a rewrite of its logic (revoke.ts is Task 6's, consumed here as-is).
 */
const GRANT_ALREADY_GONE_MESSAGE = "The grant id was not recognized.";

/**
 * `octen logout` — revoke this device's authorization, then remove the
 * local credential (design §5.2/§6.6).
 *
 * The copy here is a hard requirement, not polish: this command clears a
 * local file and revokes a *grant* (which only blocks the CLI from silently
 * minting a new credential without a fresh consent screen). It never
 * deactivates the underlying API key — that key is the user's own
 * account-wide, long-lived key, and is very likely also sitting in other
 * machines, production code, and the AI-client configs `octen
 * configure-mcp` wrote. So the output must never claim to have revoked
 * *access*, only "this authorization" — see design §5.2.
 *
 * Whether a failed revocation should keep or delete the file depends on
 * whether the failure is retriable: `OctenNetworkError` is a transport
 * fault the design says must never be treated as "the credential is
 * invalid" (§6.5), so the file is kept and `--local` is suggested. Every
 * other failure `revokeCliGrant` can throw is `OctenAuthError` from one of
 * three deterministic causes (401/403/400, revoke.ts:61-71) — the stored
 * key is no longer valid, the grant isn't bound to it, or the grant id
 * isn't recognized. All three fail identically on every retry of plain
 * `octen logout`, so keeping the file there would strand the user with
 * `--local` as the only escape hatch (and a lie for the 400 case, where the
 * authorization was already gone). Those branches delete the file and say
 * precisely why revocation didn't happen, printing the `grantId` so the
 * user can still find and clean up the authorization in the dashboard if
 * it's still listed as active there.
 */
export function registerLogout(program: Command, internal: LogoutInternalOpts = {}): void {
  program
    .command("logout")
    .description("Revoke this device's authorization and remove the locally stored credential")
    .option("--local", "remove only the local credential file; skip revoking the authorization")
    .action(async (opts: { local?: boolean }) => {
      const home = internal.home ?? os.homedir();

      let creds;
      try {
        creds = readCredentials(home);
      } catch (err) {
        // Corrupt JSON or an unrecognized CREDENTIALS_VERSION: logout's job
        // is to remove the file, not diagnose it — symmetric with
        // src/auth/login.ts's tolerance of the same failure. There is no
        // apiKey/grantId to extract from an unreadable file, so no
        // revocation is attempted (or even possible) either way, regardless
        // of --local.
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`warning: ignoring an unreadable credentials file (removing it): ${msg}\n`);
        deleteCredentials(home);
        process.stdout.write("Cleared local credentials.\n");
        return;
      }

      if (!creds) {
        process.stdout.write("Not logged in; nothing to do.\n");
        return;
      }

      if (creds.source === "api-key") {
        // A pasted key has no grant behind it — nothing to revoke, and the
        // copy must never claim otherwise (design §6.6). Zero network
        // requests on this branch.
        deleteCredentials(home);
        process.stdout.write("Cleared local credentials.\n");
        return;
      }

      // source === "login"
      if (opts.local) {
        const grantId = creds.grantId;
        deleteCredentials(home);
        process.stdout.write(
          `Cleared local credentials (--local: the authorization was not revoked). ` +
            `Grant ${grantId} can still mint a new credential without a fresh consent screen — ` +
            `revoke it from the dashboard if you want to close it out.\n`,
        );
        return;
      }

      try {
        await revokeCliGrant({
          issuer: creds.issuer,
          apiKey: creds.apiKey,
          grantId: creds.grantId,
          fetchImpl: internal.fetchImpl,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (err instanceof OctenNetworkError) {
          // A failed revocation does not mean the credential is invalid —
          // deleting it here would strand the user with no working key and
          // no way to get a new one without re-consenting. Keep the file.
          process.stderr.write(
            `Could not revoke this authorization: ${msg}\n` +
              "Local credentials were kept. Retry, or run `octen logout --local` to remove them without revoking.\n",
          );
          process.exitCode = 1;
          return;
        }

        // Every other failure is deterministic (OctenAuthError from
        // revoke.ts: 401/403/400) — retrying plain `octen logout` fails
        // identically every time, so keeping the file only strands the
        // user. Delete it, and say exactly why revocation didn't happen.
        deleteCredentials(home);
        if (msg === GRANT_ALREADY_GONE_MESSAGE) {
          process.stdout.write(
            `Cleared local credentials. The authorization was already gone on the server ` +
              `(grant ${creds.grantId}) — nothing left to revoke.\n`,
          );
        } else {
          process.stdout.write(
            `Cleared local credentials. This credential could not revoke its authorization ` +
              `(${msg}) — if grant ${creds.grantId} still shows as active in the dashboard, ` +
              `revoke it there.\n`,
          );
        }
        return;
      }

      deleteCredentials(home);
      process.stdout.write(
        "Cleared local credentials and revoked this authorization. " +
          "This does not deactivate the API key itself: the same key still works on " +
          "other machines, in production code, and in AI-client configs written by " +
          "`octen configure-mcp`. If you suspect it was exposed, deactivate or rotate the " +
          "key from the dashboard.\n",
      );
    });
}
