import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { OctenValidationError } from "../api/errors.js";

export const CREDENTIALS_VERSION = 1;

export type Credentials =
  | { version: 1; source: "api-key"; apiKey: string }
  | {
      version: 1;
      source: "login";
      issuer: string;
      resource: string;
      apiKey: string;
      apiKeyExpiresAt: number | null; // F8: always null at this stage
      grantId: string; // F11: used by logout and whoami
      accountId?: string;
      accountType?: string;
    };

/** The way out of any corrupt/unreadable/unknown-version credentials file. */
const RECOVERY_HINT = "delete ~/.octen/credentials.json and run `octen login` again.";

export function credentialsPath(home: string): string {
  return join(home, ".octen", "credentials.json");
}

function fail(reason: string): never {
  // Never echo file contents here — only a fixed, generic reason plus the recovery hint.
  throw new OctenValidationError(`Invalid credentials file (${reason}); ${RECOVERY_HINT}`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isValidExpiry(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0);
}

/**
 * Validate a parsed credentials object field by field, per `source`. Never
 * half-reads: a file missing a required field throws rather than producing an
 * object with `undefined` in later branches.
 */
function validate(obj: unknown): Credentials {
  if (obj === null || typeof obj !== "object") fail("not an object");
  const rec = obj as Record<string, unknown>;

  if (rec.version !== CREDENTIALS_VERSION) fail("unknown version");

  if (rec.source === "api-key") {
    if (!isNonEmptyString(rec.apiKey)) fail("missing apiKey");
    return { version: 1, source: "api-key", apiKey: rec.apiKey };
  }

  if (rec.source === "login") {
    if (!isNonEmptyString(rec.issuer)) fail("missing issuer");
    if (!isNonEmptyString(rec.resource)) fail("missing resource");
    if (!isNonEmptyString(rec.apiKey)) fail("missing apiKey");
    if (!isValidExpiry(rec.apiKeyExpiresAt)) fail("invalid apiKeyExpiresAt");
    if (!isNonEmptyString(rec.grantId)) fail("missing grantId");
    if (!isOptionalString(rec.accountId)) fail("invalid accountId");
    if (!isOptionalString(rec.accountType)) fail("invalid accountType");
    const creds: Credentials = {
      version: 1,
      source: "login",
      issuer: rec.issuer,
      resource: rec.resource,
      apiKey: rec.apiKey,
      apiKeyExpiresAt: rec.apiKeyExpiresAt as number | null,
      grantId: rec.grantId,
    };
    if (rec.accountId !== undefined) creds.accountId = rec.accountId;
    if (rec.accountType !== undefined) creds.accountType = rec.accountType;
    return creds;
  }

  fail("unknown source");
}

/**
 * Whitelist exactly the fields that belong to each source, so an accidental
 * extra property on the passed-in object (e.g. a smuggled `refreshToken`)
 * never reaches disk (F11).
 */
function serialize(c: Credentials): string {
  const obj: Record<string, unknown> =
    c.source === "api-key"
      ? { version: c.version, source: c.source, apiKey: c.apiKey }
      : {
          version: c.version,
          source: c.source,
          issuer: c.issuer,
          resource: c.resource,
          apiKey: c.apiKey,
          apiKeyExpiresAt: c.apiKeyExpiresAt,
          grantId: c.grantId,
          ...(c.accountId !== undefined ? { accountId: c.accountId } : {}),
          ...(c.accountType !== undefined ? { accountType: c.accountType } : {}),
        };
  return JSON.stringify(obj, null, 2);
}

export function readCredentials(home: string): Credentials | undefined {
  const path = credentialsPath(home);
  if (!existsSync(path)) return undefined;

  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("corrupt JSON");
  }
  return validate(parsed);
}

export function writeCredentials(home: string, c: Credentials): void {
  const dir = join(home, ".octen");
  mkdirSync(dir, { recursive: true });
  const path = credentialsPath(home);
  const tmp = join(dir, `.credentials.json.tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
  const json = serialize(c);
  try {
    writeFileSync(tmp, json, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }
}

export function deleteCredentials(home: string): boolean {
  const path = credentialsPath(home);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
