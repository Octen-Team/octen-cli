import { OctenValidationError } from "../api/errors.js";

/** Pre-registered public client id — must match the server-side seed (F3). */
export const CLI_CLIENT_ID = "octen-cli";
export const CLI_SCOPE = "octen:api_key";

export const REQUEST_TIMEOUT_MS = 10_000;
export const LOOPBACK_TIMEOUT_MS = 5 * 60 * 1000;

const DEFAULT_ISSUER = "https://auth.octen.ai";
const DEFAULT_RESOURCE = "https://cli.octen.ai";

/**
 * Reject a trailing slash rather than trimming it. A sibling project shipped a
 * bug where a trailing slash turned the JWKS URL into `//api/oauth/jwks` and
 * made the issuer comparison fail byte-for-byte — loud failure beats silent
 * correction.
 */
function rejectTrailingSlash(name: string, value: string): string {
  if (value.endsWith("/")) {
    throw new OctenValidationError(`${name} must not have a trailing slash: ${value}`);
  }
  return value;
}

/** OCTEN_AUTH_ISSUER, default https://auth.octen.ai. pre and prod share this
 * host (configs/pre.config.yaml:1365) — there is no auth.pre.octen.ai. */
export function authIssuer(env: NodeJS.ProcessEnv): string {
  const value = env.OCTEN_AUTH_ISSUER ?? DEFAULT_ISSUER;
  return rejectTrailingSlash("OCTEN_AUTH_ISSUER", value);
}

/** OCTEN_AUTH_RESOURCE, default https://cli.octen.ai. */
export function authResource(env: NodeJS.ProcessEnv): string {
  const value = env.OCTEN_AUTH_RESOURCE ?? DEFAULT_RESOURCE;
  return rejectTrailingSlash("OCTEN_AUTH_RESOURCE", value);
}
