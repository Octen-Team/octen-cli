import { OctenValidationError } from "./errors.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface ChatOpts {
  webSearch?: "on" | "off";
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  seed?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export function buildChatRequest(
  messages: ChatMessage[],
  model: string | undefined,
  o: ChatOpts,
): Record<string, unknown> {
  if (!model)
    throw new OctenValidationError(
      "model is required (pass --model or set OCTEN_CHAT_MODEL)",
    );
  if (!messages.length)
    throw new OctenValidationError("messages must not be empty");

  const req: Record<string, unknown> = { model, messages };
  const put = (k: string, v: unknown) => {
    if (v != null) req[k] = v;
  };

  put("web_search", o.webSearch);
  put("max_tokens", o.maxTokens);
  put("temperature", o.temperature);
  put("top_p", o.topP);
  put("frequency_penalty", o.frequencyPenalty);
  put("presence_penalty", o.presencePenalty);
  put("stop", o.stop);
  put("seed", o.seed);
  if (o.reasoningEffort != null) req["reasoning"] = { effort: o.reasoningEffort };

  return req;
}
