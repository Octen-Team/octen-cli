import pc from "picocolors";

export function renderChat(data: any): string {
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage;

  if (!usage) return content;

  const footer = pc.dim(
    `[tokens: prompt=${usage.prompt_tokens ?? "?"}, completion=${usage.completion_tokens ?? "?"}, total=${usage.total_tokens ?? "?"}]`,
  );
  return `${content}\n\n${footer}`;
}
