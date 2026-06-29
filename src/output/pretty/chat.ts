import pc from "picocolors";
import type { ChatCompletion } from "../../api/chat.js";

export function renderChat(data: ChatCompletion): string {
  const message = data?.choices?.[0]?.message;
  const content: string = message?.content ?? "";
  const reasoning = message?.reasoning;
  const annotations = message?.annotations;
  const usage = data?.usage;

  const parts: string[] = [];

  if (reasoning) {
    parts.push(pc.dim(`reasoning: ${reasoning}`));
  }

  parts.push(content);

  // Surface url_citation annotations as a list of cited sources.
  const citations = (annotations ?? [])
    .filter((a) => a?.type === "url_citation" && a.url_citation?.url)
    .map((a) => {
      const c = a.url_citation!;
      return c.title ? `${c.title} — ${c.url}` : `${c.url}`;
    });
  if (citations.length) {
    parts.push(
      pc.dim("citations:") + "\n" + citations.map((c) => pc.dim(`  - ${c}`)).join("\n"),
    );
  }

  if (usage) {
    const cached = (usage.prompt_tokens_details as any)?.cached_tokens;
    const cachedSuffix = cached != null ? `, cached=${cached}` : "";
    parts.push(
      pc.dim(
        `[tokens: prompt=${usage.prompt_tokens ?? "?"}, completion=${usage.completion_tokens ?? "?"}, total=${usage.total_tokens ?? "?"}${cachedSuffix}]`,
      ),
    );
  }

  return parts.join("\n\n");
}
