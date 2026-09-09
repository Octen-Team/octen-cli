import { authIssuer, authResource, CLI_SCOPE } from "./constants.js";
import { createState, createVerifier, challengeFor } from "./pkce.js";
import { startLoopback } from "./loopback.js";
import { authorizeUrl, exchangeCode } from "./oauthClient.js";
import { exchangeForApiKey } from "./exchange.js";
import { revokeCliGrant } from "./revoke.js";
import { CREDENTIALS_VERSION, readCredentials, writeCredentials, type Credentials } from "./store.js";

export interface LoginDeps {
  /** Injected home dir (for testing); credentials live at `<home>/.octen/credentials.json`. */
  home: string;
  /** Injected env (for testing); defaults are read through `authIssuer`/`authResource`. */
  env: NodeJS.ProcessEnv;
  /** Injected fetch (for testing); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Opens the authorize URL in a browser. Real-world spawn failures (e.g. a
   * missing browser binary) surface asynchronously, so this reports a
   * failure either by throwing synchronously OR by calling the `onFailure`
   * callback it's given — neither one fails the login, both fall back to
   * printing the URL. A machine with no browser (CI, a container, a headless
   * box over ssh) is a supported way to log in, not an error: the user can
   * always copy the printed URL to a browser elsewhere.
   */
  openBrowser: (url: string, onFailure: (err: unknown) => void) => void;
  /** `--no-browser`: print the URL instead of calling `openBrowser` at all. */
  noBrowser?: boolean;
  /** `--port`: pin the loopback callback port (for `ssh -L` forwarding). */
  port?: number;
  /** Progress/warning sink (for testing); defaults to writing to stderr. Never stdout. */
  log?: (line: string) => void;
}

/**
 * Orchestrates the eight-step loopback login flow:
 *
 *   1. best-effort revoke of an existing `source: "login"` grant — never
 *      blocks a new login, a failure is only logged. It exists so repeated
 *      logins on one machine don't pile up orphaned authorizations in the
 *      dashboard, which is a tidiness goal, never a correctness one: if the
 *      old grant cannot be revoked, the right outcome is still a working new
 *      login.
 *   2. start the loopback server
 *   3. build the authorize URL (fixed client_id, PKCE challenge, state,
 *      resource, scope)
 *   4. open the browser (or print the URL, on `--no-browser` or a spawn
 *      failure)
 *   5. wait for the authorization code
 *   6. exchange the code for an access token
 *   7. exchange the access token for the account's API key
 *   8. write credentials — THE ONLY DISK WRITE. A failure at any earlier
 *      step propagates and nothing is written, so there is no two-phase
 *      partial state to reconcile and no cleanup path to get wrong. This is
 *      what the whole design rests on: because the flow either writes one
 *      complete credential or writes nothing, and because what it writes is
 *      a long-lived key that is afterwards only ever read, credential
 *      resolution stays synchronous, lock-free, and free of any refresh
 *      logic. Nothing here may acquire a second write path.
 */
export async function login(deps: LoginDeps): Promise<Credentials> {
  const log = deps.log ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const issuer = authIssuer(deps.env);
  const resource = authResource(deps.env);

  // Step 1: best-effort revoke of a prior login grant so repeated logins
  // don't accumulate orphaned authorizations. Every failure mode here is
  // non-blocking — network error, 401, 403, 400, 503 all just log and carry
  // on. Blocking a new login because an old grant could not be tidied up
  // would turn a cosmetic problem into a lockout.
  //
  // Reading the existing file is itself guarded: `octen login` is precisely
  // the command that must not depend on an old file being readable, since
  // step 8 is about to overwrite it regardless. A corrupt file or one from
  // a future CREDENTIALS_VERSION must not make login the one command that
  // can't recover from it.
  let existing: Credentials | undefined;
  try {
    existing = readCredentials(deps.home);
  } catch (err) {
    log(`warning: ignoring an unreadable existing credentials file (continuing): ${(err as Error).message}`);
  }
  if (existing?.source === "login") {
    try {
      await revokeCliGrant({
        issuer: existing.issuer,
        apiKey: existing.apiKey,
        grantId: existing.grantId,
        fetchImpl: deps.fetchImpl,
      });
    } catch (err) {
      log(`warning: could not revoke the previous login grant (continuing): ${(err as Error).message}`);
    }
  }

  // Step 2: start the loopback server.
  const state = createState();
  const verifier = createVerifier();
  const challenge = challengeFor(verifier);
  const loop = await startLoopback({ state, port: deps.port });

  try {
    // Step 3: build the authorize URL.
    const url = authorizeUrl({
      issuer,
      redirectUri: loop.redirectUri,
      challenge,
      state,
      resource,
      scope: CLI_SCOPE,
    });

    // Step 4: open the browser, or print the URL. A spawn failure is
    // usually asynchronous (e.g. ENOENT for a missing binary), so both the
    // synchronous-throw path and the async onFailure callback route to this
    // one fallback — there is exactly one "print the URL instead" message.
    if (deps.noBrowser) {
      log(`Open this URL to log in:\n${url}`);
    } else {
      const printFallback = () =>
        log(`Could not open your browser automatically. Open this URL to log in:\n${url}`);
      try {
        deps.openBrowser(url, printFallback);
        log("Opening your browser to continue login...");
      } catch {
        printFallback();
      }
    }

    // Step 5: wait for the authorization code.
    log("Waiting for the browser redirect...");
    const code = await loop.waitForCode();

    // Step 6: exchange the code for an access token.
    const tokenSet = await exchangeCode({
      issuer,
      redirectUri: loop.redirectUri,
      code,
      verifier,
      resource,
      fetchImpl: deps.fetchImpl,
    });

    // Step 7: exchange the access token for the account's API key.
    const result = await exchangeForApiKey({
      issuer,
      accessToken: tokenSet.accessToken,
      fetchImpl: deps.fetchImpl,
    });

    // Step 8: THE single disk write.
    const creds: Credentials = {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer,
      resource,
      apiKey: result.apiKey,
      apiKeyExpiresAt: result.expiresAt,
      grantId: result.grantId,
      ...(result.accountId !== undefined ? { accountId: result.accountId } : {}),
      ...(result.accountType !== undefined ? { accountType: result.accountType } : {}),
    };
    writeCredentials(deps.home, creds);
    return creds;
  } finally {
    // Idempotent: the server already closed itself on the success path
    // (loopback.ts finalizes on code receipt). This covers every other
    // exit — an error/timeout from waitForCode, or a later step throwing.
    loop.close();
  }
}
