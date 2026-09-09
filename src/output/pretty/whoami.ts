export type WhoamiData =
  | { loggedIn: true; source: "api-key" }
  | {
      loggedIn: true;
      source: "login";
      grantId: string;
      accountId?: string;
      accountType?: string;
      apiKeyExpiresAt: number | null;
    };

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
 * Pretty-print `octen whoami` output. Reflects only the local credentials
 * file (design §6.6) — every line here is derived from disk, never from a
 * request, and the trailing note says so explicitly.
 */
export function renderWhoami(data: WhoamiData): string {
  const lines: string[] = [];

  if (data.source === "api-key") {
    lines.push("Source: api-key (set via `octen login --api-key` or a manually-configured key)");
    lines.push(
      "No account or grant information is available for this credential — it was not created via the browser login flow.",
    );
  } else {
    const who = data.accountId
      ? `${data.accountId}${data.accountType ? ` (${data.accountType})` : ""}`
      : "(account id unknown)";
    lines.push(`Account: ${who}`);
    lines.push("Source: login (browser OAuth)");
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
