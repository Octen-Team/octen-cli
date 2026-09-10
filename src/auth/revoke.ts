import { OctenAuthError, OctenNetworkError } from "../api/errors.js";
import { REQUEST_TIMEOUT_MS } from "./constants.js";

/**
 * The 400 response's message.
 *
 * This deliberately does NOT say "already gone". The server returns 400 from
 * three places and the response carries no body to tell them apart:
 *
 *   1. the grant id is unknown          → it really is gone
 *   2. the body/grant_id was unparseable → unreachable from this client
 *   3. the revoke was refused after the row was found — e.g. the subject is no
 *      longer a joined member of the organization that owns the key, or that
 *      organization is deactivated. **The grant is still `active` in this case.**
 *
 * An earlier version asserted case 1 for all three, so a user who had been
 * removed from an organization was told "nothing left to revoke" while a live
 * grant kept its ability to mint credentials — the exact outcome this command's
 * own doc comment says must never happen.
 *
 * Exported because `octen logout` branches on this case for wording. That
 * branch used to match the literal string, so editing this sentence would have
 * silently changed behaviour with no test failure anywhere; importing the
 * constant makes the coupling break at compile time instead.
 */
export const GRANT_NOT_RECOGNIZED_MESSAGE = "The server did not accept that grant id.";

/**
 * Revoke a CLI OAuth grant at `POST {issuer}/api/oauth/cli/revoke`.
 *
 * Deliberately not RFC 7009 token revocation. RFC 7009 wants a token to
 * revoke, and by this point `octen logout` has none: the access token was
 * used once at login and discarded, and no refresh token is ever stored — an
 * ostensible refresh token would expire after 30 days anyway, so keeping one
 * for logout would give a revocation path that looks available and silently
 * stops working on idle machines, which are exactly the ones a user logs out
 * from. So this authenticates with the long-lived `apiKey`
 * (header `x-api-key`) and self-certifies via `{ grant_id }` in the body —
 * the server checks that the grant's `api_key_id` matches the key's own id.
 *
 * 200 with `{}` means success, and it is idempotent: revoking an
 * already-revoked grant is also 200.
 *
 * Error classification (mirrors `exchangeForApiKey` in ./exchange.ts):
 *   - a fetch-level failure, a redirect, or 408/429/5xx is always
 *     `OctenNetworkError` — a transport/infrastructure fault.
 *   - 401 (key missing/unknown/inactive), 403 (grant not bound to that key,
 *     or not a CLI grant), and 400 (unknown/malformed grant_id) are all
 *     `OctenAuthError`.
 *
 * Callers that use this for a best-effort revoke (`octen login`'s step 1)
 * must catch every rejection themselves — nothing here is ever meant to
 * block a caller that only wants "try, and don't wait".
 *
 * No error message here ever includes `a.apiKey` or `a.grantId`.
 */
export async function revokeCliGrant(a: {
  issuer: string;
  apiKey: string;
  grantId: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const f = a.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await f(`${a.issuer}/api/oauth/cli/revoke`, {
      method: "POST",
      headers: { "x-api-key": a.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ grant_id: a.grantId }),
      // This request carries a long-lived API key — never let a redirect
      // silently forward it to a different host.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new OctenNetworkError("Could not reach the authorization server; please try again.");
  }

  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new OctenNetworkError("The authorization server returned an unexpected redirect; please try again.");
  }

  if (res.status === 408 || res.status === 429 || res.status >= 500) {
    throw new OctenNetworkError("The authorization server is unavailable; please retry later.");
  }

  if (res.status === 401) {
    throw new OctenAuthError("The stored API key is no longer valid.");
  }

  if (res.status === 403) {
    throw new OctenAuthError("That grant is not bound to the stored API key.");
  }

  if (res.status === 400) {
    throw new OctenAuthError(GRANT_NOT_RECOGNIZED_MESSAGE);
  }

  if (!res.ok) {
    throw new OctenAuthError(`Revoke failed (HTTP ${res.status}).`);
  }

  // 200: success, idempotent. Body is `{}` and carries nothing to read.
}
