import { describe, it, expect, afterEach } from "vitest";
import { applyNoColor } from "../../src/util/preflightColor.js";

describe("applyNoColor", () => {
  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  it("sets NO_COLOR=1 when --no-color is in argv", () => {
    const env: NodeJS.ProcessEnv = {};
    applyNoColor(["node", "octen", "--no-color", "--help"], env);
    expect(env.NO_COLOR).toBe("1");
  });

  it("does not set NO_COLOR when --no-color is absent", () => {
    const env: NodeJS.ProcessEnv = {};
    applyNoColor(["node", "octen", "--help"], env);
    expect(env.NO_COLOR).toBeUndefined();
  });

  it("does not overwrite an existing NO_COLOR value when --no-color is absent", () => {
    const env: NodeJS.ProcessEnv = { NO_COLOR: "existing" };
    applyNoColor(["node", "octen", "--help"], env);
    expect(env.NO_COLOR).toBe("existing");
  });
});
