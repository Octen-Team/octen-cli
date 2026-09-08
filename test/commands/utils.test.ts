import { describe, it, expect } from "vitest";
import { parseIntOpt, parseFloatOpt, parseCsvOpt } from "../../src/commands/utils.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("parseIntOpt", () => {
  it("accepts a plain decimal integer", () => {
    expect(parseIntOpt("--count")("10")).toBe(10);
  });

  it("accepts a negative integer", () => {
    expect(parseIntOpt("--count")("-2")).toBe(-2);
  });

  it("rejects a fractional value instead of truncating it", () => {
    expect(() => parseIntOpt("--count")("1.5")).toThrow("--count must be an integer");
  });

  it("rejects trailing garbage instead of parsing the numeric prefix", () => {
    expect(() => parseIntOpt("--count")("2junk")).toThrow("--count must be an integer");
  });

  it("rejects exponent notation instead of reading it as 1", () => {
    expect(() => parseIntOpt("--count")("1e2")).toThrow("--count must be an integer");
  });

  it("rejects an empty string", () => {
    expect(() => parseIntOpt("--count")("")).toThrow("--count must be an integer");
  });

  it("rejects a value beyond the safe integer range", () => {
    expect(() => parseIntOpt("--count")("9007199254740993")).toThrow(
      "--count must be a safe integer",
    );
  });

  it("throws OctenValidationError so the CLI exits 2", () => {
    expect(() => parseIntOpt("--count")("1.5")).toThrow(OctenValidationError);
  });
});

describe("parseFloatOpt", () => {
  it("accepts a plain decimal", () => {
    expect(parseFloatOpt("--fps")("1.25")).toBe(1.25);
  });

  it("accepts exponent notation", () => {
    expect(parseFloatOpt("--fps")("1e-2")).toBe(0.01);
  });

  it("rejects trailing garbage instead of parsing the numeric prefix", () => {
    expect(() => parseFloatOpt("--fps")("2junk")).toThrow("--fps must be a number");
  });

  it("rejects hex notation", () => {
    expect(() => parseFloatOpt("--fps")("0x10")).toThrow("--fps must be a number");
  });

  it("rejects an empty string", () => {
    expect(() => parseFloatOpt("--fps")("")).toThrow("--fps must be a number");
  });

  it("rejects a non-finite value", () => {
    expect(() => parseFloatOpt("--fps")("Infinity")).toThrow("--fps must be a number");
  });

  it("throws OctenValidationError so the CLI exits 2", () => {
    expect(() => parseFloatOpt("--fps")("2junk")).toThrow(OctenValidationError);
  });
});

describe("parseCsvOpt", () => {
  it("trims each item and drops interior empties", () => {
    expect(parseCsvOpt("--include-domains")(" a.com, ,b.com ")).toEqual(["a.com", "b.com"]);
  });

  it("accepts a single value", () => {
    expect(parseCsvOpt("--include-domains")("a.com")).toEqual(["a.com"]);
  });

  it("rejects a list with no non-empty values instead of sending ['']", () => {
    expect(() => parseCsvOpt("--include-domains")(" , ")).toThrow(
      "--include-domains must contain at least one non-empty value",
    );
  });

  it("rejects an empty string instead of sending ['']", () => {
    expect(() => parseCsvOpt("--include-domains")("")).toThrow(
      "--include-domains must contain at least one non-empty value",
    );
  });

  it("throws OctenValidationError so the CLI exits 2", () => {
    expect(() => parseCsvOpt("--include-domains")("")).toThrow(OctenValidationError);
  });
});
