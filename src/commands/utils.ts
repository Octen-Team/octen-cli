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

/** Commander option parser for integer flags that errors clearly on non-integers. */
export const parseIntOpt = (name: string) => (v: string): number => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new OctenValidationError(`${name} must be an integer`);
  return n;
};

/** Commander option parser for float flags that errors clearly on non-numbers. */
export const parseFloatOpt = (name: string) => (v: string): number => {
  const n = parseFloat(v);
  if (Number.isNaN(n)) throw new OctenValidationError(`${name} must be a number`);
  return n;
};
