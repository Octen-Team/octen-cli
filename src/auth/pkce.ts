import { randomBytes, createHash } from "node:crypto";

/** RFC 7636 code_verifier: 32 random bytes, base64url-encoded (43 chars, >=43 required). */
export function createVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** RFC 7636 S256 code_challenge: base64url(SHA-256(verifier)). */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** 32 random bytes, base64url-encoded — the OAuth `state` parameter. */
export function createState(): string {
  return randomBytes(32).toString("base64url");
}
