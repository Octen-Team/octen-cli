import { describe, it, expect } from "vitest";
import { createVerifier, challengeFor, createState } from "../../src/auth/pkce.js";

describe("PKCE helpers", () => {
  it("challenge is the base64url SHA-256 of the verifier (RFC 7636 appendix B vector)", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("verifier is url-safe and long enough", () => {
    const v = createVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("two verifiers are not the same value", () => {
    // Not a rigorous randomness test — just a smoke check that we are not
    // returning a constant.
    expect(createVerifier()).not.toBe(createVerifier());
  });

  it("state is url-safe and derived from 32 random bytes (base64url, no padding)", () => {
    const s = createState();
    expect(s).toMatch(/^[A-Za-z0-9\-_]+$/);
    // 32 raw bytes -> 43 base64url chars with no "=" padding.
    expect(s.length).toBe(43);
  });

  it("two states are not the same value", () => {
    expect(createState()).not.toBe(createState());
  });
});
