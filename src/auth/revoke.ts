import { OctenAuthError, OctenNetworkError } from "../api/errors.js";
import { REQUEST_TIMEOUT_MS } from "./constants.js";

/**
 * Revoke a CLI OAuth grant at `POST {issuer}/api/oauth/cli/revoke`.
 *
 * Not RFC 7009 (design §4.3) — logout has no usable bearer (access tokens
 * are used once and discarded, F6/F11) and the refresh token, even if the
 * server issued one, is never stored and would silently expire after 30
 * days regardless. So this authenticates with the long-lived `apiKey`
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
 * Callers that use this for a best-effort revoke (e.g. `octen login`'s step
 * 1, F3/R4) must catch every rejection themselves — nothing here is ever
 * meant to block a caller that only wants "try, and don't wait".
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
    throw new OctenAuthError("The grant id was not recognized.");
  }

  if (!res.ok) {
    throw new OctenAuthError(`Revoke failed (HTTP ${res.status}).`);
  }

  // 200: success, idempotent. Body is `{}` and carries nothing to read.
}
