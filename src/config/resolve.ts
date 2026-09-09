import os from "node:os";
import { DEFAULT_BASE_URL } from "../api/constants.js";
import { OctenAuthError } from "../api/errors.js";
import { readCredentials } from "../auth/store.js";
import { authIssuer, authResource } from "../auth/constants.js";

/** Names both ways out: interactive login and the environment variable. */
const NO_CREDENTIAL_MESSAGE =
  "No API key. Run `octen login`, pass --api-key, or set OCTEN_API_KEY.";

export interface ResolveApiKeyOpts {
  /** Injected home dir (for testing); defaults to os.homedir(). */
  home?: string;
}

/**
 * Resolve the API key to use: --api-key flag > OCTEN_API_KEY env >
 * ~/.octen/credentials.json (written by `octen login`) > throw.
 *
 * Stays synchronous and does no network work: the stored key never expires
 * on its own (F8's short-lived-key path is the one exception, handled below),
 * so a plain, lock-free file read is enough. Steps 1 and 2 return before
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
    throw new OctenAuthError(NO_CREDENTIAL_MESSAGE);
  }

  if (creds.source === "login") {
    // A credential minted for a different issuer/resource belongs to another
    // environment, not to this resolution. Treat it as no credential at all —
    // never use it, and never delete the file, since it isn't ours to manage.
    if (creds.issuer !== authIssuer(env) || creds.resource !== authResource(env)) {
      throw new OctenAuthError(NO_CREDENTIAL_MESSAGE);
    }
    // F8 forward-compatibility: the server returns apiKeyExpiresAt: null today,
    // so this never fires yet, but it's the first user-visible behaviour if
    // that ever changes to short-lived credentials.
    if (creds.apiKeyExpiresAt !== null && creds.apiKeyExpiresAt <= Math.floor(Date.now() / 1000)) {
      throw new OctenAuthError("Credential expired; run `octen login` again.");
    }
  }

  return creds.apiKey;
}

export function resolveBaseUrl(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  return flag || env.OCTEN_API_URL || DEFAULT_BASE_URL;
}
