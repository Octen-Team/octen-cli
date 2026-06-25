import { describe, it, expect } from "vitest";
import { buildEmbeddingRequest } from "../../src/api/embedding.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildEmbeddingRequest", () => {
  it("throws on empty string input", () => {
    expect(() => buildEmbeddingRequest("", {})).toThrow(OctenValidationError);
    expect(() => buildEmbeddingRequest("", {})).toThrow("input is required");
  });

  it("throws on empty array input", () => {
    expect(() => buildEmbeddingRequest([], {})).toThrow(OctenValidationError);
    expect(() => buildEmbeddingRequest([], {})).toThrow("input is required");
  });

  it("maps model shortcut '4b' to 'octen-embedding-4b'", () => {
    const req = buildEmbeddingRequest("hello", { model: "4b" });
    expect(req.model).toBe("octen-embedding-4b");
  });

  it("maps model shortcut '0.6b' to 'octen-embedding-0.6b'", () => {
    const req = buildEmbeddingRequest("hello", { model: "0.6b" });
    expect(req.model).toBe("octen-embedding-0.6b");
  });

  it("maps model shortcut '8b' to 'octen-embedding-8b'", () => {
    const req = buildEmbeddingRequest("hello", { model: "8b" });
    expect(req.model).toBe("octen-embedding-8b");
  });

  it("passes unknown/full model id through unchanged", () => {
    const req = buildEmbeddingRequest("hello", { model: "octen-embedding-4b" });
    expect(req.model).toBe("octen-embedding-4b");

    const req2 = buildEmbeddingRequest("hello", { model: "some-custom-model" });
    expect(req2.model).toBe("some-custom-model");
  });

  it("includes only provided fields", () => {
    const req = buildEmbeddingRequest("hello", {});
    expect(Object.keys(req)).toEqual(["input"]);
  });

  it("includes all provided fields with correct snake_case key mapping", () => {
    const req = buildEmbeddingRequest(["a", "b"], {
      model: "4b",
      dimension: 512,
      inputType: "query",
      truncation: true,
    });
    expect(req.input).toEqual(["a", "b"]);
    expect(req.model).toBe("octen-embedding-4b");
    expect(req.dimension).toBe(512);
    expect(req.input_type).toBe("query");
    expect(req.truncation).toBe(true);
    // no camelCase leak
    expect((req as any).inputType).toBeUndefined();
  });

  it("preserves truncation: false (falsy but explicit)", () => {
    const req = buildEmbeddingRequest("hello", { truncation: false });
    expect(req.truncation).toBe(false);
  });

  it("omits truncation when not provided", () => {
    const req = buildEmbeddingRequest("hello", {});
    expect(Object.keys(req)).not.toContain("truncation");
  });
});
