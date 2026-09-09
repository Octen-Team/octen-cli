import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LOOPBACK_TIMEOUT_MS } from "./constants.js";

export interface LoopbackServer {
  port: number;
  /** http://127.0.0.1:<port>/callback — literal IP per RFC 8252 §8.3, never `localhost`. */
  redirectUri: string;
  /** Same promise on every call. Settles exactly once: code, error, timeout or close(). */
  waitForCode(): Promise<string>;
  /** Idempotent. Releases the port through the same path as every other exit. */
  close(): void;
}

const SUCCESS_HTML =
  "<!doctype html><html><body><p>Login successful. You can close this tab.</p></body></html>";
const FAILURE_HTML =
  "<!doctype html><html><body><p>Login failed. You can close this tab and return to the terminal.</p></body></html>";

/**
 * A one-shot HTTP server on 127.0.0.1 that answers exactly one OAuth
 * authorization-code redirect on /callback, then shuts itself down.
 *
 * Security notes (127.0.0.1 is reachable by every local process, not just
 * the browser):
 *  - `state` is validated BEFORE an `error` parameter is honoured, so a
 *    forged `?error=access_denied&state=wrong` from another local process
 *    cannot fail a real login.
 *  - A wrong-state request gets 400 and the server keeps listening —
 *    it never exits on a forged callback.
 *  - There is no cap on wrong-state attempts, only the deadline — a fixed
 *    cap would itself be an attack ("send N bogus callbacks to kill any
 *    login").
 *  - Every exit path (success, error, timeout, external close()) settles
 *    through the same `finalize`, which clears the timer and closes the
 *    server exactly once.
 */
export function startLoopback(opts: {
  state: string;
  port?: number;
  timeoutMs?: number;
}): Promise<LoopbackServer> {
  const { state, port = 0, timeoutMs = LOOPBACK_TIMEOUT_MS } = opts;

  return new Promise((resolveStart, rejectStart) => {
    let settled = false;
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });
    // A caller that never calls waitForCode() (e.g. the timeout/close path
    // fires before anyone awaits it) must not produce an unhandled rejection.
    codePromise.catch(() => {});

    let timer: NodeJS.Timeout;
    let server: Server;

    function finalize(settle: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
      // Force-close any lingering keep-alive sockets so the port is free the
      // instant this returns, not whenever the client happens to disconnect.
      server.closeAllConnections?.();
      server.close();
    }

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const reqState = url.searchParams.get("state");
      if (reqState !== state) {
        // Keep listening: this may be a forgery from another local process,
        // not the real browser redirect.
        res.writeHead(400, { "content-type": "text/plain" }).end("invalid state");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(200, { "content-type": "text/html" }).end(FAILURE_HTML);
        finalize(() => rejectCode(new Error(`OAuth error: ${error}`)));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "content-type": "text/plain" }).end("missing code");
        return;
      }

      res.writeHead(200, { "content-type": "text/html" }).end(SUCCESS_HTML);
      finalize(() => resolveCode(code));
    });

    server.on("error", (err) => {
      rejectStart(err);
    });

    // Literal 127.0.0.1, never "localhost" — RFC 8252 §8.3: localhost can be
    // redirected via the hosts file, 127.0.0.1 cannot.
    server.listen(port, "127.0.0.1", () => {
      const actualPort = (server.address() as AddressInfo).port;

      timer = setTimeout(() => {
        finalize(() => rejectCode(new Error("Login timed out waiting for the browser redirect")));
      }, timeoutMs);
      timer.unref();

      resolveStart({
        port: actualPort,
        redirectUri: `http://127.0.0.1:${actualPort}/callback`,
        waitForCode: () => codePromise,
        close: () => finalize(() => rejectCode(new Error("Loopback server closed"))),
      });
    });
  });
}
