import os from "node:os";
import type { Command } from "commander";
import { readCredentials, deleteCredentials } from "../auth/store.js";
import { revokeCliGrant } from "../auth/revoke.js";

export interface LogoutInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir(). */
  home?: string;
  /**
   * Injected fetch (for testing); defaults to global fetch. Never invoked
   * for a `source: "api-key"` credential (no grant exists to revoke) or
   * when `--local` is passed (design §6.6) — both branches make zero
   * network requests.
   */
  fetchImpl?: typeof fetch;
}

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
 */
export function registerLogout(program: Command, internal: LogoutInternalOpts = {}): void {
  program
    .command("logout")
    .description("Revoke this device's authorization and remove the locally stored credential")
    .option("--local", "remove only the local credential file; skip revoking the authorization")
    .action(async (opts: { local?: boolean }) => {
      const home = internal.home ?? os.homedir();
      const creds = readCredentials(home);

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
        deleteCredentials(home);
        process.stdout.write(
          "Cleared local credentials (--local: the authorization was not revoked). " +
            "It can still be used to mint a new credential without a fresh consent screen; " +
            "revoke it from the dashboard, or run `octen logout` without --local.\n",
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
        // A failed revocation does not mean the credential is invalid —
        // deleting it here would strand the user with no working key and
        // no way to get a new one without re-consenting. Keep the file.
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `Could not revoke this authorization: ${msg}\n` +
            "Local credentials were kept. Retry, or run `octen logout --local` to remove them without revoking.\n",
        );
        process.exitCode = 1;
        return;
      }

      deleteCredentials(home);
      process.stdout.write(
        "Cleared local credentials and revoked this authorization. " +
          "This does not deactivate the API key itself: the same key may still work on " +
          "other machines, in production code, or in AI-client configs written by " +
          "`octen configure-mcp`. If you suspect it was exposed, deactivate or rotate the " +
          "key from the dashboard.\n",
      );
    });
}
