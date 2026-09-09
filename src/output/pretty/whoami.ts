/**
 * Which of the three credential sources (`--api-key` > `OCTEN_API_KEY` >
 * the stored file) `resolveApiKey` would actually pick right now. `"none"`
 * means every command would fail with "No API key" — including when a
 * credentials file exists but is being ignored.
 */
export type EffectiveKeySource = "--api-key" | "OCTEN_API_KEY" | "credentials-file" | "none";

/**
 * Why the stored credential is not the one in effect. The first two are
 * decided before the file is read at all; the last three mirror
 * `credentialIgnoredReason` in src/config/resolve.ts.
 */
export type WhoamiIgnoredReason =
  | "flag-shadowed"
  | "env-shadowed"
  | "issuer-mismatch"
  | "resource-mismatch"
  | "expired";

/** Fields common to every "a credentials file exists" shape. */
interface WhoamiEffect {
  loggedIn: true;
  effectiveSource: EffectiveKeySource;
  /** Would `resolveApiKey` return THIS credential's key? */
  inEffect: boolean;
  ignoredReason?: WhoamiIgnoredReason;
  /** Only present for a mismatch, and only for the field that mismatched. */
  expectedIssuer?: string;
  expectedResource?: string;
}

export type WhoamiData =
  | { loggedIn: false; effectiveSource: EffectiveKeySource }
  | (WhoamiEffect & { source: "api-key" })
  | (WhoamiEffect & {
      source: "login";
      issuer: string;
      resource: string;
      grantId: string;
      accountId?: string;
      accountType?: string;
      apiKeyExpiresAt: number | null;
    });

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "expired";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * The "In effect:" line — the one `whoami` was missing. Before this, `whoami`
 * described the file's credential as live while `octen search` refused to use
 * it, in the same second on the same machine. Every branch names both the
 * cause and the way out.
 */
function effectLine(data: WhoamiEffect, stored: { issuer?: string; resource?: string } = {}): string {
  if (data.inEffect) return "In effect: yes — commands use this stored credential.";

  switch (data.ignoredReason) {
    case "flag-shadowed":
      return (
        "In effect: no — --api-key was passed on this command line and takes precedence, " +
        "so that key is used instead of this stored credential."
      );
    case "env-shadowed":
      return (
        "In effect: no — OCTEN_API_KEY is set in the environment and takes precedence, " +
        "so commands use that key, not this stored credential. Unset OCTEN_API_KEY to use it."
      );
    case "issuer-mismatch":
      return (
        `In effect: no — this credential was issued for issuer ${stored.issuer}, ` +
        `but OCTEN_AUTH_ISSUER selects ${data.expectedIssuer}, so every command ignores it. ` +
        "Unset OCTEN_AUTH_ISSUER, or run `octen login` again."
      );
    case "resource-mismatch":
      return (
        `In effect: no — this credential was issued for resource ${stored.resource}, ` +
        `but OCTEN_AUTH_RESOURCE selects ${data.expectedResource}, so every command ignores it. ` +
        "Unset OCTEN_AUTH_RESOURCE, or run `octen login` again."
      );
    case "expired":
      return "In effect: no — this credential has expired. Run `octen login` again.";
    default:
      return "In effect: no.";
  }
}

/**
 * Pretty-print `octen whoami` output. Reflects only the local credentials
 * file (design §6.6) — every line here is derived from disk, never from a
 * request, and the trailing note says so explicitly.
 */
export function renderWhoami(data: WhoamiData): string {
  const lines: string[] = [];

  if (!data.loggedIn) {
    lines.push("Not logged in (no local credential file).");
    if (data.effectiveSource === "OCTEN_API_KEY") {
      lines.push("In effect: OCTEN_API_KEY from the environment — commands use that key.");
    } else if (data.effectiveSource === "--api-key") {
      lines.push("In effect: the --api-key passed on this command line.");
    } else {
      lines.push("No API key is in effect. Run `octen login`, or `octen login --api-key <key>`.");
    }
    lines.push("(Read from the local credentials file only — no network request was made.)");
    return lines.join("\n");
  }

  if (data.source === "api-key") {
    lines.push("Source: api-key (set via `octen login --api-key` or a manually-configured key)");
    lines.push(effectLine(data));
    lines.push(
      "No account or grant information is available for this credential — it was not created via the browser login flow.",
    );
  } else {
    const who = data.accountId
      ? `${data.accountId}${data.accountType ? ` (${data.accountType})` : ""}`
      : "(account id unknown)";
    lines.push(`Account: ${who}`);
    lines.push("Source: login (browser OAuth)");
    lines.push(effectLine(data, { issuer: data.issuer, resource: data.resource }));
    lines.push(`Issuer: ${data.issuer}`);
    lines.push(`Resource: ${data.resource}`);
    lines.push(
      `Grant: ${data.grantId} — find and revoke this device in the dashboard's authorization list.`,
    );
    if (data.apiKeyExpiresAt !== null) {
      const remaining = data.apiKeyExpiresAt - Math.floor(Date.now() / 1000);
      lines.push(`API key expires in: ${formatRemaining(remaining)}`);
    } else {
      lines.push("API key: does not expire");
    }
  }

  lines.push("(Read from the local credentials file only — no network request was made.)");
  return lines.join("\n");
}
