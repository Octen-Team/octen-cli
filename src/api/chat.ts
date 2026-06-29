import { OctenValidationError } from "./errors.js";
import { normalizeTimeBound } from "./search.js";
import { LIMITS } from "./constants.js";

/** A cache_control marker that can ride along on a content block. */
export interface CacheControl {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

/** A structured content block (used when we need to attach cache_control). */
export interface ContentBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentBlock[];
};

/** A url_citation annotation attached to an assistant message. */
export interface UrlCitation {
  type: "url_citation";
  url_citation?: {
    url?: string;
    title?: string;
    start_index?: number;
    end_index?: number;
  };
}

/** Non-stream chat completion response. All fields optional — the server is untyped. */
export interface ChatCompletion {
  choices?: Array<{
    message?: {
      content?: string;
      /** The model's reasoning trace, when reasoning is enabled. */
      reasoning?: string;
      annotations?: UrlCitation[];
    };
  }>;
  /** Web search results surfaced by the octen_search tool. */
  search_results?: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
}

/**
 * A single SSE stream event from the chat endpoint. The new protocol emits typed
 * chunks (search_done / content / finish / usage) terminated by a `[DONE]` sentinel.
 */
export interface StreamEvent {
  type?: "search_done" | "content" | "finish" | "usage" | string;
  choices?: Array<{ delta?: { content?: string; reasoning?: string } }>;
  usage?: Record<string, unknown>;
}

export const VERBOSITY_OPTIONS = ["low", "medium", "high"] as const;
export type Verbosity = (typeof VERBOSITY_OPTIONS)[number];

export const REASONING_EFFORT_OPTIONS = [
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_OPTIONS)[number];

export const SEARCH_TIME_BASIS_OPTIONS = ["auto", "published", "crawled"] as const;
export type SearchTimeBasis = (typeof SEARCH_TIME_BASIS_OPTIONS)[number];

export const SEARCH_SAFESEARCH_OPTIONS = ["off", "strict"] as const;
export type SearchSafesearch = (typeof SEARCH_SAFESEARCH_OPTIONS)[number];

export const SEARCH_FORMAT_OPTIONS = ["markdown", "text"] as const;
export type SearchFormat = (typeof SEARCH_FORMAT_OPTIONS)[number];

/** Options for the built-in octen_search tool (web search). */
export interface SearchOpts {
  enabled?: boolean;
  maxSearches?: number;
  count?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  timeBasis?: SearchTimeBasis;
  startTime?: string;
  endTime?: string;
  format?: SearchFormat;
  safesearch?: SearchSafesearch;
  fullContent?: boolean;
  fullContentMaxTokens?: number;
  highlightMaxTokens?: number;
}

export interface ChatOpts {
  search?: SearchOpts;
  maxTokens?: number;
  maxCompletionTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  topA?: number;
  repetitionPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  seed?: number;
  verbosity?: Verbosity;
  reasoningEffort?: ReasoningEffort;
  reasoningMaxTokens?: number;
  /** When true, attach cache_control to the system message content block. */
  cacheSystem?: boolean;
}

function assertEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): void {
  if (value != null && !allowed.includes(value as T)) {
    throw new OctenValidationError(`${flag} must be one of: ${allowed.join(", ")}`);
  }
}

/** Build the octen_search tool entry from search options. */
function buildSearchTool(s: SearchOpts): Record<string, unknown> {
  assertEnum(s.timeBasis, SEARCH_TIME_BASIS_OPTIONS, "--search-time-basis");
  assertEnum(s.safesearch, SEARCH_SAFESEARCH_OPTIONS, "--search-safesearch");
  assertEnum(s.format, SEARCH_FORMAT_OPTIONS, "--search-format");
  if (s.count != null && (s.count < LIMITS.searchCount.min || s.count > LIMITS.searchCount.max))
    throw new OctenValidationError(`--search-count must be ${LIMITS.searchCount.min}-${LIMITS.searchCount.max}`);

  const parameters: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v != null) parameters[k] = v;
  };

  put("max_searches", s.maxSearches);
  put("count", s.count);
  put("include_domains", s.includeDomains);
  put("exclude_domains", s.excludeDomains);
  put("include_text", s.includeText);
  put("exclude_text", s.excludeText);
  put("time_basis", s.timeBasis);
  put("start_time", normalizeTimeBound("--search-start-time", s.startTime, false));
  put("end_time", normalizeTimeBound("--search-end-time", s.endTime, true));
  put("format", s.format);
  put("safesearch", s.safesearch);

  if (s.fullContent) {
    parameters["full_content"] = {
      enable: true,
      ...(s.fullContentMaxTokens != null ? { max_tokens: s.fullContentMaxTokens } : {}),
    };
  }
  if (s.highlightMaxTokens != null) {
    parameters["highlight"] = { enable: true, max_tokens: s.highlightMaxTokens };
  }

  return { type: "octen_search", parameters };
}

/**
 * Wrap message content so the system message can carry cache_control. The system
 * message becomes a single text content block tagged ephemeral; other messages are
 * left untouched.
 */
function applyCacheControl(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role !== "system" || typeof m.content !== "string") return m;
    const block: ContentBlock = {
      type: "text",
      text: m.content,
      cache_control: { type: "ephemeral", ttl: "5m" },
    };
    return { role: "system", content: [block] };
  });
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

  assertEnum(o.verbosity, VERBOSITY_OPTIONS, "--verbosity");
  assertEnum(o.reasoningEffort, REASONING_EFFORT_OPTIONS, "--reasoning-effort");

  const outMessages = o.cacheSystem ? applyCacheControl(messages) : messages;

  const req: Record<string, unknown> = { model, messages: outMessages };
  const put = (k: string, v: unknown) => {
    if (v != null) req[k] = v;
  };

  put("max_tokens", o.maxTokens);
  put("max_completion_tokens", o.maxCompletionTokens);
  put("temperature", o.temperature);
  put("top_p", o.topP);
  put("top_k", o.topK);
  put("min_p", o.minP);
  put("top_a", o.topA);
  put("repetition_penalty", o.repetitionPenalty);
  put("frequency_penalty", o.frequencyPenalty);
  put("presence_penalty", o.presencePenalty);
  put("stop", o.stop);
  put("seed", o.seed);
  put("verbosity", o.verbosity);

  if (o.reasoningEffort != null || o.reasoningMaxTokens != null) {
    const reasoning: Record<string, unknown> = {};
    if (o.reasoningEffort != null) reasoning["effort"] = o.reasoningEffort;
    if (o.reasoningMaxTokens != null) reasoning["max_tokens"] = o.reasoningMaxTokens;
    req["reasoning"] = reasoning;
  }

  if (o.search?.enabled) {
    req["tools"] = [buildSearchTool(o.search)];
  }

  return req;
}
