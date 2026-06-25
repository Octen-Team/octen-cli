import { describe, it, expect } from "vitest";
import { resolveApiKey, resolveBaseUrl } from "../../src/config/resolve.js";
import { OctenAuthError } from "../../src/api/errors.js";

describe("resolve", () => {
  it("prefers --api-key flag over env", () => {
    expect(resolveApiKey("flagkey", { OCTEN_API_KEY: "envkey" })).toBe("flagkey");
  });
  it("falls back to env", () => {
    expect(resolveApiKey(undefined, { OCTEN_API_KEY: "envkey" })).toBe("envkey");
  });
  it("throws OctenAuthError when missing", () => {
    expect(() => resolveApiKey(undefined, {})).toThrow(OctenAuthError);
  });
  it("resolves base url flag > env > default", () => {
    expect(resolveBaseUrl("https://f", {})).toBe("https://f");
    expect(resolveBaseUrl(undefined, { OCTEN_API_URL: "https://e" })).toBe("https://e");
    expect(resolveBaseUrl(undefined, {})).toBe("https://api.octen.ai");
  });
});
