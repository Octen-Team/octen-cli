import os from "node:os";
import { DEFAULT_BASE_URL } from "../api/constants.js";
import { OctenAuthError, OctenNoCredentialError } from "../api/errors.js";
import { readCredentials, type Credentials } from "../auth/store.js";
import { authIssuer, authResource } from "../auth/constants.js";

/** Names both ways out: interactive login and the environment variable. */
const NO_CREDENTIAL_MESSAGE =
  "No API key. Run `octen login`, pass --api-key, or set OCTEN_API_KEY.";

/**
 * Why a stored credential is not the one commands will use. `undefined` means
 * it is usable. Deliberately does NOT cover flag/env shadowing: those are
 * decided before the file is even read (`resolveApiKey` steps 1-2), and
 * `octen whoami` labels them separately.
 */
export type CredentialIgnoredReason = "issuer-mismatch" | "resource-mismatch" | "expired";

/**
 * The single place that decides whether a stored credential is usable.
 * `resolveApiKey` calls it below, and so does `octen whoami`
 * (`src/commands/whoami.ts` calls it via this export) — sharing the one
 * function is what stops `whoami` from reporting a credential that no other
 * command would touch.
 *
 * Synchronous and network-free, like everything on this path.
 */
export function credentialIgnoredReason(
  creds: Credentials,
  env: NodeJS.ProcessEnv,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): CredentialIgnoredReason | undefined {
  // A pasted key carries no issuer/resource/expiry — nothing to disqualify it.
  if (creds.source !== "login") return undefined;

  // A credential minted for a different issuer/resource belongs to another
  // environment, not to this resolution. Treat it as no credential at all —
  // never use it, and never delete the file, since it isn't ours to manage.
  if (creds.issuer !== authIssuer(env)) return "issuer-mismatch";
  if (creds.resource !== authResource(env)) return "resource-mismatch";

  // Forward-compatibility only: the server returns apiKeyExpiresAt: null for
  // every credential it mints today, so this branch never fires yet. It is
  // here so that if short-lived keys ever ship, an expired credential names
  // itself instead of surfacing as an opaque 401 from the first API call.
  if (creds.apiKeyExpiresAt !== null && creds.apiKeyExpiresAt <= nowSeconds) return "expired";

  return undefined;
}

/**
 * The message for a credential that exists on disk but was minted for another
 * environment. It deliberately does NOT reuse NO_CREDENTIAL_MESSAGE: telling
 * the user to run `octen login` when an OCTEN_AUTH_* override is the cause
 * sends them through a browser consent flow that cannot fix anything.
 */
export function mismatchMessage(
  reason: "issuer-mismatch" | "resource-mismatch",
  stored: string,
  expected: string,
): string {
  const varName = reason === "issuer-mismatch" ? "OCTEN_AUTH_ISSUER" : "OCTEN_AUTH_RESOURCE";
  return (
    `A stored credential exists, but it was issued for ${stored} while ${varName} selects ` +
    `${expected}, so it is being ignored. Unset ${varName} to use the stored credential, or ` +
    `run \`octen login\` again to get one for ${expected}. \`octen whoami\` shows which ` +
    `credential is in effect.`
  );
}

export interface ResolveApiKeyOpts {
  /** Injected home dir (for testing); defaults to os.homedir(). */
  home?: string;
}

/**
 * Resolve the API key to use: --api-key flag > OCTEN_API_KEY env >
 * ~/.octen/credentials.json (written by `octen login`) > throw.
 *
 * Stays synchronous and does no network work: the stored key never expires
 * on its own (the not-yet-reachable short-lived-key path below is the only
 * exception), so a plain, lock-free file read is enough. This is the property
 * everything else depends on: the credential is written once, by `octen
 * login`, and afterwards only read — so there is no refresh to serialize, no
 * lock to hold, and no reason for this function to become async. Making it
 * async would ripple into every command's client construction. Steps 1 and 2 return before
 * touching the disk at all, so an explicit flag or env var never pays for a
 * file read and always wins over a stale or foreign login.
 */
export function resolveApiKey(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  opts: ResolveApiKeyOpts = {},
): string {
  const key = flag || env.OCTEN_API_KEY;
  if (key) return key;

  const home = opts.home ?? os.homedir();
  const creds = readCredentials(home);
  if (!creds) {
    throw new OctenNoCredentialError(NO_CREDENTIAL_MESSAGE);
  }

  if (creds.source === "login") {
    const reason = credentialIgnoredReason(creds, env);
    if (reason === "expired") {
      throw new OctenAuthError("Credential expired; run `octen login` again.");
    }
    if (reason !== undefined) {
      const stored = reason === "issuer-mismatch" ? creds.issuer : creds.resource;
      const expected = reason === "issuer-mismatch" ? authIssuer(env) : authResource(env);
      throw new OctenAuthError(mismatchMessage(reason, stored, expected));
    }
  }

  return creds.apiKey;
}

export function resolveBaseUrl(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  return flag || env.OCTEN_API_URL || DEFAULT_BASE_URL;
}
