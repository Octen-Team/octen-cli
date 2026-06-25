import { describe, it, expect } from "vitest";
import { chooseMode } from "../../src/output/render.js";

describe("chooseMode", () => {
  it("forces json when --json", () => expect(chooseMode({ json: true }, true)).toBe("json"));
  it("forces pretty when --pretty", () => expect(chooseMode({ pretty: true }, false)).toBe("pretty"));
  it("pretty on tty by default", () => expect(chooseMode({}, true)).toBe("pretty"));
  it("json when piped by default", () => expect(chooseMode({}, false)).toBe("json"));
});
