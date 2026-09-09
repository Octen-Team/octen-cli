import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startLoopback } from "../../src/auth/loopback.js";

/** Resolves once `port` can be bound again — proves the previous server truly released it. */
async function assertPortIsFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => {
      probe.close((err) => (err ? reject(err) : resolve()));
    });
  });
}

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => probe.once("listening", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  return port;
}

describe("startLoopback", () => {
  it("resolves with the code when state matches", async () => {
    const srv = await startLoopback({ state: "s-ok" });
    const pending = srv.waitForCode();
    const r = await fetch(`${srv.redirectUri}?code=abc123&state=s-ok`);
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(body).not.toContain("abc123");
    await expect(pending).resolves.toBe("abc123");
    srv.close();
  });

  it("keeps listening after a wrong-state request, then accepts the real one", async () => {
    // 127.0.0.1 is open to every process on this machine. If one forged
    // callback could make the server exit, any local process could make the
    // real callback land on a closed port and hang the login until timeout.
    const srv = await startLoopback({ state: "s-real" });
    const pending = srv.waitForCode();
    const bogus = await fetch(`${srv.redirectUri}?code=evil&state=s-wrong`);
    expect(bogus.status).toBe(400);
    await fetch(`${srv.redirectUri}?code=good&state=s-real`);
    await expect(pending).resolves.toBe("good");
    srv.close();
  });

  it("validates state BEFORE honouring an error callback", async () => {
    // ?error=access_denied&state=WRONG must not fail the login — it may be a
    // forgery from another local process.
    const srv = await startLoopback({ state: "real" });
    const pending = srv.waitForCode();
    const r = await fetch(`${srv.redirectUri}?error=access_denied&state=wrong`);
    expect(r.status).toBe(400);
    await fetch(`${srv.redirectUri}?code=ok&state=real`);
    await expect(pending).resolves.toBe("ok");
    srv.close();
  });

  it("surfaces an error callback that carries the correct state", async () => {
    const srv = await startLoopback({ state: "real" });
    const pending = srv.waitForCode();
    const r = await fetch(`${srv.redirectUri}?error=access_denied&state=real`);
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(body).not.toContain("access_denied");
    await expect(pending).rejects.toThrow(/access_denied/);
  });

  it("gives up on wrong-state flooding only by deadline, never by a fixed count", async () => {
    // A fixed cap is itself an attack: "send N bogus callbacks to terminate
    // any login."
    const srv = await startLoopback({ state: "real", timeoutMs: 3000 });
    const pending = srv.waitForCode();
    for (let i = 0; i < 50; i++) await fetch(`${srv.redirectUri}?code=x&state=wrong`);
    await fetch(`${srv.redirectUri}?code=ok&state=real`);
    await expect(pending).resolves.toBe("ok");
  });

  it("rejects on timeout", async () => {
    const srv = await startLoopback({ state: "s", timeoutMs: 50 });
    await expect(srv.waitForCode()).rejects.toThrow(/timed out|超时/);
    srv.close();
  });

  it("releases the port on success, error, timeout and external close", async () => {
    const port = await freePort();

    // success
    let srv = await startLoopback({ state: "s", port });
    let pending = srv.waitForCode();
    await fetch(`${srv.redirectUri}?code=c&state=s`);
    await expect(pending).resolves.toBe("c");
    await assertPortIsFree(port);

    // error
    srv = await startLoopback({ state: "s", port });
    pending = srv.waitForCode();
    const rejection = expect(pending).rejects.toThrow(/access_denied/);
    await fetch(`${srv.redirectUri}?error=access_denied&state=s`);
    await rejection;
    await assertPortIsFree(port);

    // timeout
    srv = await startLoopback({ state: "s", port, timeoutMs: 30 });
    await expect(srv.waitForCode()).rejects.toThrow(/timed out|超时/);
    await assertPortIsFree(port);

    // external close
    srv = await startLoopback({ state: "s", port });
    pending = srv.waitForCode();
    const closedRejection = expect(pending).rejects.toThrow();
    srv.close();
    await closedRejection;
    await assertPortIsFree(port);
  });

  it("honours an explicit free port", async () => {
    // A hardcoded port would collide in CI: ask the OS for a free one first,
    // then require the loopback server to reuse it.
    const free = await freePort();
    const srv = await startLoopback({ state: "s", port: free });
    expect(srv.port).toBe(free);
    srv.close();
  });

  it("only answers /callback; other paths 404", async () => {
    const srv = await startLoopback({ state: "s" });
    const pending = srv.waitForCode();
    const other = await fetch(`http://127.0.0.1:${srv.port}/not-callback`);
    expect(other.status).toBe(404);
    await fetch(`${srv.redirectUri}?code=ok&state=s`);
    await expect(pending).resolves.toBe("ok");
  });

  it("redirectUri points at 127.0.0.1 literally, never localhost", async () => {
    // RFC 8252 §8.3 — `localhost` can be redirected via the hosts file.
    const srv = await startLoopback({ state: "s" });
    expect(srv.redirectUri).toBe(`http://127.0.0.1:${srv.port}/callback`);
    srv.close();
  });

  it("waitForCode called twice returns the same promise", async () => {
    const srv = await startLoopback({ state: "s" });
    const first = srv.waitForCode();
    const second = srv.waitForCode();
    expect(first).toBe(second);
    await fetch(`${srv.redirectUri}?code=z&state=s`);
    await expect(first).resolves.toBe("z");
  });

  it("waitForCode called after close() rejects", async () => {
    const srv = await startLoopback({ state: "s" });
    srv.close();
    await expect(srv.waitForCode()).rejects.toThrow();
  });

  it("close() after the server already settled is a harmless no-op", async () => {
    const srv = await startLoopback({ state: "s" });
    const pending = srv.waitForCode();
    await fetch(`${srv.redirectUri}?code=z&state=s`);
    await pending;
    expect(() => srv.close()).not.toThrow();
  });
});
