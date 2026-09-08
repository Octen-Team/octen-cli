import { OctenClient } from "../api/client.js";
import { OctenValidationError } from "../api/errors.js";
import { resolveApiKey, resolveBaseUrl } from "../config/resolve.js";

/** Build an OctenClient from resolved global options (flag > env). */
export function makeClient(g: { apiKey?: string; baseUrl?: string }): OctenClient {
  return new OctenClient({
    apiKey: resolveApiKey(g.apiKey, process.env),
    baseUrl: resolveBaseUrl(g.baseUrl, process.env),
  });
}

/** Optional sign followed by decimal digits — nothing else. */
const INTEGER = /^-?\d+$/;
/** Decimal, fractional or exponent notation, whole-string. Rejects hex and trailing garbage. */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Commander option parser for integer flags. Lexical only: a value that is not
 * exactly an integer is rejected rather than truncated, so `1.5`, `2junk` and
 * `1e2` name themselves instead of silently becoming `1`, `2` and `1`. Range
 * checks stay in the request builders, which own the published limits.
 */
export const parseIntOpt = (name: string) => (v: string): number => {
  if (!INTEGER.test(v)) throw new OctenValidationError(`${name} must be an integer`);
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new OctenValidationError(`${name} must be a safe integer`);
  return n;
};

/** Commander option parser for float flags. Whole-string match, finite result only. */
export const parseFloatOpt = (name: string) => (v: string): number => {
  if (!DECIMAL.test(v)) throw new OctenValidationError(`${name} must be a number`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new OctenValidationError(`${name} must be a number`);
  return n;
};

/**
 * Commander option parser for comma-separated list flags. Each item is trimmed
 * and empty items are dropped; a list with nothing left is an error rather than
 * a `[""]` or `[]` that would reach the API as a filter nobody asked for.
 */
export const parseCsvOpt = (name: string) => (v: string): string[] => {
  const values = v.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new OctenValidationError(`${name} must contain at least one non-empty value`);
  }
  return values;
};

export const SCOPE_OPTIONS = ["user", "project"] as const;
export type ConfigScope = (typeof SCOPE_OPTIONS)[number];

/**
 * Commander option parser for `--scope`. An unknown scope is an error: coercing
 * it to `user` would write a config file to a location the caller did not ask
 * for, and `reset` would then delete from the wrong one.
 */
export const parseScopeOpt = (name: string) => (v: string): ConfigScope => {
  if (!(SCOPE_OPTIONS as readonly string[]).includes(v)) {
    throw new OctenValidationError(`${name} must be one of: ${SCOPE_OPTIONS.join(", ")}`);
  }
  return v as ConfigScope;
};
