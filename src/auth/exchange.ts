import { OctenAuthError, OctenNetworkError } from "../api/errors.js";
import { REQUEST_TIMEOUT_MS } from "./constants.js";

/**
 * The account's long-lived API key, resolved from an access token via
 * `POST {issuer}/api/oauth/cli/key`.
 */
export interface ExchangeResult {
  apiKey: string;
  expiresAt: number | null; // F8: the server always returns null at this stage
  grantId: string; // F11: used by logout and whoami
  accountId?: string;
  accountType?: string;
}

/**
 * Convert the server's ISO-8601 `expires_at` to epoch seconds. `null` stays
 * `null` (F8: this is a forward-compatibility slot the server does not yet
 * populate). Anything else that fails to parse returns `undefined` so the
 * caller can treat it as a contract violation rather than silently falling
 * back to local time.
 */
function parseExpiresAt(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / 1000);
}

/**
 * Exchange an access token for the account's own long-lived API key at
 * `POST {issuer}/api/oauth/cli/key`.
 *
 * This is the public counterpart of the existing internal
 * `/internal/oauth/resolve-key` service call (design §4.2): same
 * authorization facts, different authentication — a Bearer access token
 * instead of a shared service secret. The server reads the grant id out of
 * the token's own session, never from the caller, so this request carries no
 * body at all.
 *
 * Error classification (design §6.5) — by transport layer FIRST, then body,
 * mirroring `exchangeCode` in `./oauthClient.ts`:
 *   - a fetch-level failure (DNS, connection reset, our own timeout) is
 *     always `OctenNetworkError`.
 *   - any 3xx (or an opaque redirect from `redirect: "manual"`) is treated as
 *     a transport-layer fault, never followed: a request carrying a bearer
 *     token must not be forwarded to an unintended host.
 *   - 408 / 429 / 5xx are always `OctenNetworkError`, EVEN IF the body claims
 *     `active: false` — a server fault dressed up as a credential problem
 *     must never trigger credential deletion downstream.
 *   - 401 is always `OctenAuthError`: missing/non-Bearer/unusable token, or
 *     (via the 200 path below) a grant that no longer resolves.
 *   - 403 is always `OctenAuthError`: audience/scope/client mismatch,
 *     independent of the body; retrying cannot help.
 *   - a 200 body with `active: false` is `OctenAuthError` too.
 *   - a 200 body missing `api_key`, or whose `expires_at` cannot be parsed,
 *     is `OctenNetworkError` — a contract violation, never silently absorbed.
 *
 * No error message here ever includes `a.accessToken` or a returned API key.
 */
export async function exchangeForApiKey(a: {
  issuer: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<ExchangeResult> {
  const f = a.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await f(`${a.issuer}/api/oauth/cli/key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${a.accessToken}` },
      // This request carries a bearer token — never let a redirect silently
      // forward it to a different host.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new OctenNetworkError("Could not reach the authorization server; please try again.");
  }

  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new OctenNetworkError("The authorization server returned an unexpected redirect; please try again.");
  }

  // Transport-layer classification wins over the body, even when the body
  // claims a credential problem (design §6.5).
  if (res.status === 408 || res.status === 429 || res.status >= 500) {
    throw new OctenNetworkError("The authorization server is unavailable; please retry later.");
  }

  if (res.status === 401) {
    throw new OctenAuthError("Your session is no longer valid. Run `octen login` again.");
  }

  if (res.status === 403) {
    throw new OctenAuthError("Authorization was refused. Run `octen login` again.");
  }

  if (!res.ok) {
    throw new OctenAuthError(`Key exchange failed (HTTP ${res.status}). Run \`octen login\` again.`);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new OctenNetworkError("The authorization server returned an invalid response; please try again.");
  }

  const body = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

  if (body.active === false) {
    throw new OctenAuthError("Your session is no longer valid. Run `octen login` again.");
  }

  const apiKey = body.api_key;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new OctenNetworkError("The authorization server did not return an API key; please try again.");
  }

  const grantId = body.grant_id;
  if (typeof grantId !== "string" || grantId.length === 0) {
    throw new OctenNetworkError("The authorization server did not return a grant id; please try again.");
  }

  const expiresAt = parseExpiresAt(body.expires_at);
  if (expiresAt === undefined) {
    throw new OctenNetworkError("The authorization server returned an invalid expiry; please try again.");
  }

  const accountId = typeof body.account_id === "string" ? body.account_id : undefined;
  const accountType = typeof body.account_type === "string" ? body.account_type : undefined;

  return { apiKey, expiresAt, grantId, accountId, accountType };
}
