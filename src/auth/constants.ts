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

/** RFC 8252 §8.3 loopback literals. `localhost` is deliberately absent: it can be
 *  redirected via the hosts file, so it earns no plaintext exemption. */
function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

/**
 * Every origin that this CLI will send a credential to must be https, with the
 * single exception of a loopback literal (a locally running authorization
 * server, which is what the OCTEN_AUTH_ISSUER doc below invites).
 *
 * This is load-bearing, not hygiene. Two requests carry secrets to whatever
 * this string names: `exchange.ts` sends the access token to `/api/oauth/cli/key`,
 * and `revoke.ts` sends the account-wide, long-lived API key to
 * `/api/oauth/cli/revoke`. Before this check existed, `OCTEN_AUTH_ISSUER=http://…`
 * put both on the wire in cleartext with no warning, and `store.ts` accepted any
 * non-empty string as a *stored* issuer, so a credentials file could name an
 * arbitrary plaintext host and `login`/`logout` would mail the key to it.
 *
 * Exported because store.ts must apply the identical rule to the issuer it reads
 * back off disk — one rule, one implementation, or the two drift.
 */
export function assertSecureOrigin(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OctenValidationError(`${name} must be an absolute URL: ${value}`);
  }
  if (url.username || url.password) {
    throw new OctenValidationError(`${name} must not contain credentials: ${value}`);
  }
  if (url.protocol === "https:") return value;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return value;
  throw new OctenValidationError(
    `${name} must use https (or http on a 127.0.0.1 loopback address for local development): ${value}`,
  );
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
  return assertSecureOrigin("OCTEN_AUTH_ISSUER", rejectTrailingSlash("OCTEN_AUTH_ISSUER", value));
}

/**
 * OCTEN_AUTH_RESOURCE, default https://cli.octen.ai.
 *
 * Unlike the issuer this is never dialled — it is an audience identifier that
 * goes into the authorize request and is compared byte-for-byte on the server.
 * So it gets the trailing-slash rule (a mismatch there is a silent auth
 * failure) but not the https rule: nothing is ever sent *to* it.
 */
export function authResource(env: NodeJS.ProcessEnv): string {
  const value = env.OCTEN_AUTH_RESOURCE ?? DEFAULT_RESOURCE;
  return rejectTrailingSlash("OCTEN_AUTH_RESOURCE", value);
}
