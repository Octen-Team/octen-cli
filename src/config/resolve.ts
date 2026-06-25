import { DEFAULT_BASE_URL } from "../api/constants.js";
import { OctenAuthError } from "../api/errors.js";

export function resolveApiKey(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const key = flag || env.OCTEN_API_KEY;
  if (!key) {
    throw new OctenAuthError(
      "No API key. Pass --api-key or set OCTEN_API_KEY. Get one at https://octen.ai",
    );
  }
  return key;
}

export function resolveBaseUrl(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  return flag || env.OCTEN_API_URL || DEFAULT_BASE_URL;
}
