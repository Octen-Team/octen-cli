import { OctenValidationError } from "../api/errors.js";

/**
 * The pre-registered public client id. This is not a value the CLI chooses:
 * it must byte-match the client row seeded on the authorization server, and a
 * mismatch fails at the authorize step with `invalid_client`, before the user
 * ever sees a consent screen. There is no dynamic client registration, so
 * nothing negotiates this at runtime — it is a cross-repository constant.
 */
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

/**
 * OCTEN_AUTH_ISSUER, default https://auth.octen.ai.
 *
 * Note that the pre-production and production environments share this one
 * auth host — there is no `auth.pre.octen.ai`, and inventing one by analogy
 * with the other per-environment hostnames will produce a DNS failure rather
 * than a pre-prod login. Point this at a locally running authorization server
 * for development instead.
 */
export function authIssuer(env: NodeJS.ProcessEnv): string {
  const value = env.OCTEN_AUTH_ISSUER ?? DEFAULT_ISSUER;
  return rejectTrailingSlash("OCTEN_AUTH_ISSUER", value);
}

/** OCTEN_AUTH_RESOURCE, default https://cli.octen.ai. */
export function authResource(env: NodeJS.ProcessEnv): string {
  const value = env.OCTEN_AUTH_RESOURCE ?? DEFAULT_RESOURCE;
  return rejectTrailingSlash("OCTEN_AUTH_RESOURCE", value);
}
