import { describe, it, expect } from "vitest";
import { renderBroadSearch } from "../../../src/output/pretty/broadSearch.js";

// Mirrors the real /broad-search envelope: data.data with query/queries/search_results.
const fixture = {
  data: {
    query: "cloud gpu pricing",
    queries: ["aws gpu pricing", "gcp gpu pricing"],
    search_results: [
      {
        query: "aws gpu pricing",
        results: [{ title: "AWS GPU", url: "https://aws.example", highlight: "aws snippet" }],
        latency: 110,
      },
      {
        query: "gcp gpu pricing",
        results: [{ title: "GCP GPU", url: "https://gcp.example", full_content: "gcp body" }],
        latency: 120,
      },
    ],
  },
  code: 0,
  msg: "success",
  request_id: "req-1",
};

describe("renderBroadSearch", () => {
  it("renders a header per sub-query and its results", () => {
    const out = renderBroadSearch(fixture);
    expect(out).toContain("aws gpu pricing");
    expect(out).toContain("AWS GPU");
    expect(out).toContain("https://aws.example");
    expect(out).toContain("aws snippet");
    expect(out).toContain("gcp gpu pricing");
    expect(out).toContain("GCP GPU");
    expect(out).toContain("gcp body");
  });

  it("handles empty groups without crashing", () => {
    const out = renderBroadSearch({ data: { search_results: [] }, code: 0, msg: "success" });
    expect(typeof out).toBe("string");
    expect(out).toContain("No results");
  });

  it("surfaces an app-level API error (non-zero code)", () => {
    const out = renderBroadSearch({ data: {}, code: 40001, msg: "invalid params" });
    expect(out).toContain("error");
    expect(out).toContain("invalid params");
  });
});
