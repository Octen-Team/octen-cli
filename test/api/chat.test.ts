import { describe, it, expect } from "vitest";
import { buildChatRequest } from "../../src/api/chat.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildChatRequest", () => {
  const msgs = [{ role: "user" as const, content: "hello" }];

  it("throws if model is missing", () => {
    expect(() => buildChatRequest(msgs, undefined, {})).toThrow(OctenValidationError);
    expect(() => buildChatRequest(msgs, undefined, {})).toThrow(/model is required/);
  });

  it("throws if messages is empty", () => {
    expect(() => buildChatRequest([], "gpt-4", {})).toThrow(OctenValidationError);
    expect(() => buildChatRequest([], "gpt-4", {})).toThrow(/messages/i);
  });

  it("maps reasoningEffort -> reasoning.effort", () => {
    const req = buildChatRequest(msgs, "gpt-4", { reasoningEffort: "high" });
    expect(req).toMatchObject({ reasoning: { effort: "high" } });
  });

  it("includes only provided fields", () => {
    const req = buildChatRequest(msgs, "gpt-4", { temperature: 0.7 });
    expect(req).toMatchObject({ model: "gpt-4", temperature: 0.7 });
    expect(req).not.toHaveProperty("max_tokens");
    expect(req).not.toHaveProperty("top_p");
    expect(req).not.toHaveProperty("web_search");
    expect(req).not.toHaveProperty("reasoning");
  });

  it("passes messages through unchanged", () => {
    const req = buildChatRequest(msgs, "gpt-4", {});
    expect(req.messages).toEqual(msgs);
  });

  it("maps all snake_case fields correctly", () => {
    const req = buildChatRequest(msgs, "m", {
      webSearch: "on",
      maxTokens: 512,
      temperature: 0.5,
      topP: 0.9,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      stop: ["END"],
      seed: 42,
      reasoningEffort: "low",
    });
    expect(req).toMatchObject({
      model: "m",
      web_search: "on",
      max_tokens: 512,
      temperature: 0.5,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      stop: ["END"],
      seed: 42,
      reasoning: { effort: "low" },
    });
  });
});
