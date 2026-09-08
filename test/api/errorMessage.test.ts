import { describe, it, expect } from "vitest";
import { errorMessage } from "../../src/api/errors.js";

describe("errorMessage", () => {
  it("prefers msg, then message, then detail", () => {
    expect(errorMessage({ msg: "a", message: "b", detail: "c" }, "fb")).toBe("a");
    expect(errorMessage({ message: "b", detail: "c" }, "fb")).toBe("b");
    expect(errorMessage({ detail: "c" }, "fb")).toBe("c");
  });

  it("recurses into a nested error object", () => {
    expect(errorMessage({ error: { message: "inner" } }, "fb")).toBe("inner");
    expect(errorMessage({ error: { error: { msg: "deep" } } }, "fb")).toBe("deep");
  });

  it("accepts a string error value", () => {
    expect(errorMessage({ error: "plain" }, "fb")).toBe("plain");
  });

  it("never returns an empty or non-string value", () => {
    expect(errorMessage({ msg: "" }, "fb")).toBe("fb");
    expect(errorMessage({ msg: "   " }, "fb")).toBe("fb");
    expect(errorMessage({ msg: 42 }, "fb")).toBe("fb");
    expect(errorMessage({ error: {} }, "fb")).toBe("fb");
    expect(errorMessage(null, "fb")).toBe("fb");
    expect(errorMessage("just a string body", "fb")).toBe("just a string body");
  });

  it("does not loop forever on a self-referential payload", () => {
    const payload: Record<string, unknown> = {};
    payload.error = payload;
    expect(errorMessage(payload, "fb")).toBe("fb");
  });
});
