import { describe, it, expect } from "vitest";
import { renderEmbedding } from "../../../src/output/pretty/embedding.js";

// Primary fixture mirrors the REAL Octen API envelope: results live at data.results.
const fixture = {
  data: {
    model: "octen-embedding-4b",
    results: [
      { index: 0, embedding: [0.1, 0.2, 0.3] },
      { index: 1, embedding: [0.4, 0.5, 0.6] },
    ],
  },
  code: 0,
  msg: "success",
};

describe("renderEmbedding", () => {
  it("unwraps the envelope and renders dimension count (3) for each vector", () => {
    const out = renderEmbedding(fixture);
    expect(out).toContain("3");
  });

  it("renders model name when present", () => {
    const out = renderEmbedding(fixture);
    expect(out).toContain("octen-embedding-4b");
  });

  it("renders --json hint in footer", () => {
    const out = renderEmbedding(fixture);
    expect(out).toContain("--json");
  });

  it("does NOT render raw float values (no vector printing)", () => {
    const out = renderEmbedding(fixture);
    expect(out).not.toContain("0.1");
    expect(out).not.toContain("0.4");
  });

  it("still renders an un-enveloped (top-level data) response via the ?? data fallback", () => {
    const flat = {
      model: "octen-embedding-4b",
      data: [{ embedding: [1, 2, 3, 4] }],
    };
    const out = renderEmbedding(flat);
    expect(out).toContain("4");
    expect(out).toContain("octen-embedding-4b");
  });

  it("handles embeddings field as alternative to results array", () => {
    const alt = {
      model: "octen-embedding-4b",
      embeddings: [{ embedding: [1, 2, 3, 4] }],
    };
    const out = renderEmbedding(alt);
    expect(out).toContain("4");
  });

  it("handles item.vector as alternative to item.embedding", () => {
    const alt = {
      data: { results: [{ vector: [1, 2, 3, 4, 5] }] },
    };
    const out = renderEmbedding(alt);
    expect(out).toContain("5");
  });

  it("handles item itself being the array (bare array item)", () => {
    const alt = {
      data: { results: [[0.1, 0.2, 0.3, 0.4]] },
    };
    const out = renderEmbedding(alt);
    expect(out).toContain("4");
  });

  it("handles empty results gracefully with friendly message", () => {
    const out = renderEmbedding({ data: { results: [] } });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("handles missing data/embeddings field gracefully", () => {
    const out = renderEmbedding({});
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("renders row index (0-based or 1-based) for each embedding", () => {
    const out = renderEmbedding(fixture);
    // Should show index numbers for both rows
    expect(out).toContain("1");
    expect(out).toContain("2");
  });
});
