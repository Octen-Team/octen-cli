import { OctenAuthError, OctenNetworkError } from "../api/errors.js";
import { CLI_CLIENT_ID, REQUEST_TIMEOUT_MS } from "./constants.js";

/**
 * The result of a code->token exchange. Deliberately just the access token:
 * F6 means there is no refresh path, and F11 means the refresh token (even if
 * the server issued one) is never stored. Used once, then discarded.
 */
export interface TokenSet {
  accessToken: string;
}

/**
 * Build the `GET {issuer}/oauth/authorize` URL for the loopback flow.
 *
 * `client_id` is fixed to `CLI_CLIENT_ID` and is NOT a parameter (F3: the CLI
 * is pre-registered with the server, there is no dynamic client
 * registration) — every other value is per-flow.
 */
export function authorizeUrl(a: {
  issuer: string;
  redirectUri: string;
  challenge: string;
  state: string;
  resource: string;
  scope: string;
}): string {
  const u = new URL(`${a.issuer}/oauth/authorize`);
  u.searchParams.set("client_id", CLI_CLIENT_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", a.redirectUri);
  u.searchParams.set("code_challenge", a.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", a.state);
  u.searchParams.set("resource", a.resource);
  u.searchParams.set("scope", a.scope);
  return u.toString();
}

/**
 * Read an OAuth `error` code out of a token-endpoint error body, if present.
 * Never throws — an unparseable or unexpected shape just yields `undefined`.
 */
function oauthErrorCode(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>).error;
  return typeof value === "string" ? value : undefined;
}

/**
 * Exchange an authorization code for an access token at
 * `POST {issuer}/api/oauth/token`.
 *
 * Error classification (design §6.5) — by transport layer FIRST, then body:
 *   - a fetch-level failure (DNS, connection reset, our own timeout) is
 *     always `OctenNetworkError`.
 *   - any 3xx (or an opaque redirect from `redirect: "manual"`) is treated as
 *     a transport-layer fault, never followed: a POST carrying the code and
 *     the PKCE verifier must not be forwarded to an unintended host.
 *   - 408 / 429 / 5xx are always `OctenNetworkError`, EVEN IF the body claims
 *     `invalid_grant` — a server fault dressed up as `invalid_grant` must
 *     never trigger credential deletion downstream.
 *   - 403 is always `OctenAuthError` (audience/scope/client mismatch;
 *     retrying cannot help), independent of the body.
 *   - any other 4xx whose body's `error` is `invalid_grant` or
 *     `invalid_client` is `OctenAuthError`.
 *   - any other 4xx falls back to `OctenAuthError` too: it is not one of the
 *     retryable transport codes above, so per "classify by transport first"
 *     it can never land in the network bucket.
 *
 * No error message here ever includes `a.code`, `a.verifier`, or a returned
 * access token.
 */
export async function exchangeCode(a: {
  issuer: string;
  redirectUri: string;
  code: string;
  verifier: string;
  resource: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenSet> {
  const f = a.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: a.code,
    redirect_uri: a.redirectUri,
    client_id: CLI_CLIENT_ID,
    code_verifier: a.verifier,
    resource: a.resource,
  });

  let res: Response;
  try {
    res = await f(`${a.issuer}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      // The body carries the code and verifier — never let a redirect
      // silently forward them to a different host.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new OctenNetworkError("Could not reach the authorization server; please try again.");
  }

  // redirect: "manual" surfaces a same-implementation 3xx as an
  // "opaqueredirect" response (status 0, no body); a mocked/proxied fetch may
  // instead hand back the raw 3xx directly. Treat either as an error.
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new OctenNetworkError("The authorization server returned an unexpected redirect; please try again.");
  }

  if (res.ok) {
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new OctenNetworkError("The authorization server returned an invalid response; please try again.");
    }
    const accessToken =
      payload !== null && typeof payload === "object"
        ? (payload as Record<string, unknown>).access_token
        : undefined;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new OctenNetworkError("The authorization server did not return an access token; please try again.");
    }
    return { accessToken };
  }

  // Transport-layer classification wins over the body, even when the body
  // claims invalid_grant (design §6.5).
  if (res.status === 408 || res.status === 429 || res.status >= 500) {
    throw new OctenNetworkError("The authorization server is unavailable; please try again later.");
  }

  if (res.status === 403) {
    throw new OctenAuthError("Authorization was refused. Run `octen login` again.");
  }

  const rawText = await res.text().catch(() => "");
  let payload: unknown;
  try {
    payload = rawText ? JSON.parse(rawText) : undefined;
  } catch {
    payload = undefined;
  }
  const errorCode = oauthErrorCode(payload);
  if (errorCode === "invalid_grant" || errorCode === "invalid_client") {
    throw new OctenAuthError("The authorization code is no longer valid. Run `octen login` again.");
  }

  // Any remaining 4xx: not one of the recognized transport-retryable codes
  // above, so it is never classified as a network error.
  throw new OctenAuthError(`Token exchange failed (HTTP ${res.status}). Run \`octen login\` again.`);
}
