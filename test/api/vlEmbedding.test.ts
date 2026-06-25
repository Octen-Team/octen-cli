import { describe, it, expect } from "vitest";
import { parseContentTokens, buildVlEmbeddingRequest } from "../../src/api/vlEmbedding.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("parseContentTokens", () => {
  it("parses a text token", () => {
    expect(parseContentTokens(["text:hello world"])).toEqual([{ text: "hello world" }]);
  });

  it("parses an image token", () => {
    expect(parseContentTokens(["image:https://example.com/img.png"])).toEqual([
      { image: "https://example.com/img.png" },
    ]);
  });

  it("parses a video token", () => {
    expect(parseContentTokens(["video:https://example.com/vid.mp4"])).toEqual([
      { video: "https://example.com/vid.mp4" },
    ]);
  });

  it("preserves colons in values (splits on first colon only)", () => {
    const result = parseContentTokens(["image:https://x.com/a.png?foo=1&bar=2"]);
    expect(result).toEqual([{ image: "https://x.com/a.png?foo=1&bar=2" }]);
  });

  it("handles https:// URLs correctly (colons in value preserved)", () => {
    const result = parseContentTokens(["image:https://cdn.example.com/photo.jpg"]);
    expect(result[0]).toEqual({ image: "https://cdn.example.com/photo.jpg" });
  });

  it("preserves order of multiple tokens", () => {
    const result = parseContentTokens([
      "text:a cat",
      "image:https://x.com/c.png",
      "text:a dog",
    ]);
    expect(result).toEqual([
      { text: "a cat" },
      { image: "https://x.com/c.png" },
      { text: "a dog" },
    ]);
  });

  it("throws OctenValidationError for unknown prefix", () => {
    expect(() => parseContentTokens(["foo:bar"])).toThrow(OctenValidationError);
    expect(() => parseContentTokens(["foo:bar"])).toThrow(
      /invalid content token "foo:bar": must start with text:, image:, or video:/,
    );
  });

  it("throws OctenValidationError for token with no colon", () => {
    expect(() => parseContentTokens(["helloworld"])).toThrow(OctenValidationError);
    expect(() => parseContentTokens(["helloworld"])).toThrow(/invalid content token/);
  });

  it("throws OctenValidationError for empty value", () => {
    expect(() => parseContentTokens(["text:"])).toThrow(OctenValidationError);
    expect(() => parseContentTokens(["text:"])).toThrow(/invalid content token/);
  });

  it("throws OctenValidationError for audio prefix (not in allowed set)", () => {
    expect(() => parseContentTokens(["audio:https://x.com/a.mp3"])).toThrow(OctenValidationError);
  });
});

describe("buildVlEmbeddingRequest", () => {
  const oneText = [{ text: "hello" }];
  const twoImages = [
    { image: "https://a.com/1.png" },
    { image: "https://a.com/2.png" },
  ];

  it("throws when contents is empty", () => {
    expect(() => buildVlEmbeddingRequest([], { model: "base" })).toThrow(OctenValidationError);
    expect(() => buildVlEmbeddingRequest([], { model: "base" })).toThrow(/empty/);
  });

  it("throws when more than 20 contents total", () => {
    const contents = Array.from({ length: 21 }, (_, i) => ({ text: `t${i}` }));
    expect(() => buildVlEmbeddingRequest(contents, { model: "base" })).toThrow(OctenValidationError);
    expect(() => buildVlEmbeddingRequest(contents, { model: "base" })).toThrow(/20/);
  });

  it("throws when more than 5 images", () => {
    const contents = Array.from({ length: 6 }, (_, i) => ({
      image: `https://a.com/${i}.png`,
    }));
    expect(() => buildVlEmbeddingRequest(contents, { model: "base" })).toThrow(OctenValidationError);
    expect(() => buildVlEmbeddingRequest(contents, { model: "base" })).toThrow(/5 images/);
  });

  it("throws when more than 1 video", () => {
    const contents = [
      { video: "https://a.com/1.mp4" },
      { video: "https://a.com/2.mp4" },
    ];
    expect(() => buildVlEmbeddingRequest(contents, { model: "base" })).toThrow(OctenValidationError);
    expect(() => buildVlEmbeddingRequest(contents, { model: "base" })).toThrow(/1 video/);
  });

  it("maps model alias 'base' to 'octen-vl-embedding'", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "base" });
    expect(req.model).toBe("octen-vl-embedding");
  });

  it("maps model alias 'large' to 'octen-vl-embedding-large'", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "large" });
    expect(req.model).toBe("octen-vl-embedding-large");
  });

  it("passes full model id through unchanged", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "octen-vl-embedding" });
    expect(req.model).toBe("octen-vl-embedding");
  });

  it("throws OctenValidationError when model is not provided", () => {
    expect(() => buildVlEmbeddingRequest(oneText, {})).toThrow(OctenValidationError);
    expect(() => buildVlEmbeddingRequest(oneText, {})).toThrow(
      /model is required \(pass --model base\|large\)/,
    );
  });

  it("produces correct body shape with model and input.contents", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "base" });
    expect(req).toMatchObject({
      model: "octen-vl-embedding",
      input: { contents: oneText },
    });
  });

  it("omits enable_fusion when fusion is undefined", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "base" });
    expect(Object.keys(req)).not.toContain("enable_fusion");
  });

  it("includes enable_fusion: true when fusion is true", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "base", fusion: true });
    expect(req.enable_fusion).toBe(true);
  });

  it("includes enable_fusion: false when fusion is explicitly false", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "base", fusion: false });
    expect(req.enable_fusion).toBe(false);
  });

  it("includes optional dimension when provided", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "base", dimension: 512 });
    expect(req.dimension).toBe(512);
  });

  it("includes optional fps when provided", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "base", fps: 2.5 });
    expect(req.fps).toBe(2.5);
  });

  it("includes optional instruct when provided", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "base", instruct: "describe the image" });
    expect(req.instruct).toBe("describe the image");
  });

  it("omits optional fields when not provided", () => {
    const req = buildVlEmbeddingRequest(oneText, { model: "base" });
    const keys = Object.keys(req);
    expect(keys).not.toContain("dimension");
    expect(keys).not.toContain("fps");
    expect(keys).not.toContain("instruct");
  });

  it("accepts exactly 20 contents (boundary)", () => {
    const contents = Array.from({ length: 20 }, (_, i) => ({ text: `t${i}` }));
    expect(() => buildVlEmbeddingRequest(contents, { model: "base" })).not.toThrow();
  });

  it("accepts exactly 5 images (boundary)", () => {
    const contents = Array.from({ length: 5 }, (_, i) => ({
      image: `https://a.com/${i}.png`,
    }));
    expect(() => buildVlEmbeddingRequest(contents, { model: "base" })).not.toThrow();
  });

  it("accepts exactly 1 video (boundary)", () => {
    const contents = [{ video: "https://a.com/1.mp4" }];
    expect(() => buildVlEmbeddingRequest(contents, { model: "base" })).not.toThrow();
  });
});
