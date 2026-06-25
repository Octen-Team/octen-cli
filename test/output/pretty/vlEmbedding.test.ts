import { describe, it, expect } from "vitest";
import { renderVlEmbedding } from "../../../src/output/pretty/vlEmbedding.js";

const fixture = {
  model: "octen-vl-embedding",
  data: [{ embedding: [1, 2, 3, 4], type: "vl" }],
};

describe("renderVlEmbedding", () => {
  it("renders dimension count (4)", () => {
    const out = renderVlEmbedding(fixture);
    expect(out).toContain("4");
  });

  it("renders the type field", () => {
    const out = renderVlEmbedding(fixture);
    expect(out).toContain("vl");
  });

  it("renders the model name", () => {
    const out = renderVlEmbedding(fixture);
    expect(out).toContain("octen-vl-embedding");
  });

  it("renders --json hint", () => {
    const out = renderVlEmbedding(fixture);
    expect(out).toContain("--json");
  });

  it("does NOT render raw float values", () => {
    const out = renderVlEmbedding(fixture);
    expect(out).not.toContain("1,2,3");
    expect(out).not.toContain("1, 2, 3");
  });

  it("handles data.embeddings as alternative array", () => {
    const alt = {
      model: "octen-vl-embedding",
      embeddings: [{ embedding: [1, 2, 3, 4, 5], type: "fusion" }],
    };
    const out = renderVlEmbedding(alt);
    expect(out).toContain("5");
    expect(out).toContain("fusion");
  });

  it("handles data.items as alternative array", () => {
    const alt = {
      model: "octen-vl-embedding",
      items: [{ embedding: [1, 2], type: "vl" }],
    };
    const out = renderVlEmbedding(alt);
    expect(out).toContain("2");
  });

  it("handles item.vector as alternative to item.embedding", () => {
    const alt = {
      model: "octen-vl-embedding",
      data: [{ vector: [1, 2, 3], type: "vl" }],
    };
    const out = renderVlEmbedding(alt);
    expect(out).toContain("3");
  });

  it("handles bare array item", () => {
    const alt = {
      data: [[0.1, 0.2, 0.3, 0.4, 0.5]],
    };
    const out = renderVlEmbedding(alt);
    expect(out).toContain("5");
  });

  it("handles multiple items", () => {
    const multi = {
      model: "octen-vl-embedding",
      data: [
        { embedding: [1, 2, 3], type: "vl" },
        { embedding: [1, 2, 3, 4, 5, 6], type: "fusion" },
      ],
    };
    const out = renderVlEmbedding(multi);
    expect(out).toContain("3");
    expect(out).toContain("6");
    expect(out).toContain("fusion");
  });

  it("handles empty data with a friendly fallback message", () => {
    const out = renderVlEmbedding({ data: [] });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("handles missing data/embeddings/items gracefully", () => {
    const out = renderVlEmbedding({});
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
