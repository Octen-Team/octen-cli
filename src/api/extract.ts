import { LIMITS } from "./constants.js";
import { OctenValidationError } from "./errors.js";

export interface ExtractOpts {
  query?: string;
  maxAge?: number;
  format?: "markdown" | "text";
  fetchTimeout?: number;
  images?: boolean;
  videos?: boolean;
  audio?: boolean;
  favicon?: boolean;
}

export function buildExtractRequest(urls: string[], o: ExtractOpts): Record<string, unknown> {
  if (urls.length < LIMITS.extractUrls.min || urls.length > LIMITS.extractUrls.max)
    throw new OctenValidationError(
      `urls must be ${LIMITS.extractUrls.min}-${LIMITS.extractUrls.max} items`,
    );

  if (o.fetchTimeout != null && (o.fetchTimeout < LIMITS.extractTimeout.min || o.fetchTimeout > LIMITS.extractTimeout.max))
    throw new OctenValidationError(
      `fetch-timeout must be ${LIMITS.extractTimeout.min}-${LIMITS.extractTimeout.max}`,
    );

  // Auto-prefix bare hosts
  const normalizedUrls = urls.map((u) => (u.includes("://") ? u : `https://${u}`));

  // Clamp maxAge
  const maxAge =
    o.maxAge != null
      ? Math.min(LIMITS.cacheWindow.max, Math.max(LIMITS.cacheWindow.min, o.maxAge))
      : undefined;

  const req: Record<string, unknown> = { urls: normalizedUrls };
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };

  put("query", o.query);
  put("max_age_seconds", maxAge);
  put("format", o.format);
  put("timeout", o.fetchTimeout);
  put("include_images", o.images);
  put("include_videos", o.videos);
  put("include_audio", o.audio);
  put("include_favicon", o.favicon);

  return req;
}
