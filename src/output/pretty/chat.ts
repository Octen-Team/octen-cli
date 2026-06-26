import pc from "picocolors";
import type { ChatCompletion } from "../../api/chat.js";

export function renderChat(data: ChatCompletion): string {
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage;

  if (!usage) return content;

  const footer = pc.dim(
    `[tokens: prompt=${usage.prompt_tokens ?? "?"}, completion=${usage.completion_tokens ?? "?"}, total=${usage.total_tokens ?? "?"}]`,
  );
  return `${content}\n\n${footer}`;
}
