# octen CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `octen-cli` — a TypeScript/Node CLI (`octen`) exposing Octen's full API (search/news/fetch/chat/embed/vl-embed) plus `configure-mcp` / `configure-skills` / `reset`, distributed via npm.

**Architecture:** Self-contained package. A portable typed API client (`src/api/`, future `@octen/sdk`) over native `fetch`. Thin commander commands parse flags → call the client → render TTY-aware output (pretty vs JSON). MCP/skills config commands write merge-safely into per-client config files. Skills are fetched from upstream `Octen-Team/web-search-skills` on each run, with a bundled vendored copy as offline fallback.

**Tech Stack:** TypeScript (ESM, Node ≥18, native `fetch`), `commander` (CLI), `picocolors` (color), `vitest` (tests). No HTTP library — native `fetch` + `ReadableStream` for SSE.

**Design doc:** `docs/plans/2026-06-25-octen-cli-design.md` (read it before starting).

**Conventions for every task below:** TDD (failing test → run → implement → run → commit). Exact paths. Run `npx vitest run <file>` for a single file. Commit after each green task with the given message.

---

## Phase 0 — Scaffolding

### Task 0.1: package.json

**Files:** Create `package.json`

**Step 1: Write the file**

```json
{
  "name": "octen-cli",
  "version": "0.1.0",
  "description": "Command-line tool for Octen — web search, extract, chat, embeddings, and one-command MCP/Skills setup.",
  "type": "module",
  "license": "MIT",
  "author": "Octen <hello@octen.ai>",
  "bin": { "octen": "dist/cli.js" },
  "files": ["dist", "skills", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc && chmod +x dist/cli.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "sync-skills": "tsx scripts/sync-skills.ts",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "picocolors": "^1.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 2: Install** — Run: `npm install`. Expected: lockfile created, no errors.

**Step 3: Commit**
```bash
git add package.json package-lock.json && git commit -m "chore: scaffold package.json"
```

### Task 0.2: tsconfig + vitest config + .gitignore

**Files:** Create `tsconfig.json`, `vitest.config.ts`, `.gitignore`

**Step 1: tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Step 2: vitest.config.ts**
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
```

**Step 3: .gitignore**
```
node_modules/
dist/
*.log
.DS_Store
```

**Step 4: Commit**
```bash
git add tsconfig.json vitest.config.ts .gitignore && git commit -m "chore: add ts/vitest config"
```

### Task 0.3: CLI entry stub (version + help work)

**Files:** Create `src/cli.ts`; Test `test/cli.test.ts`

**Step 1: Write the failing test** (`test/cli.test.ts`)
```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runCli(args: string[]): string {
  return execFileSync("node", ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8" });
}

describe("cli", () => {
  it("prints version", () => {
    expect(runCli(["--version"]).trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("lists commands in help", () => {
    const help = runCli(["--help"]);
    for (const c of ["search", "fetch", "chat", "embed", "vl-embed", "configure-mcp", "configure-skills", "reset"]) {
      expect(help).toContain(c);
    }
  });
});
```

**Step 2: Run to verify it fails** — Run: `npx vitest run test/cli.test.ts`. Expected: FAIL (cannot find `src/cli.ts`).

**Step 3: Write minimal implementation** (`src/cli.ts`)
```ts
#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

const program = new Command();
program
  .name("octen")
  .description("Octen CLI — search, extract, chat, embeddings, and MCP/Skills setup")
  .version(pkg.version);

// Command stubs (filled in later phases). Each just registers name + summary for now.
for (const [name, desc] of [
  ["search", "Search the live web"],
  ["news", "News-focused web search"],
  ["fetch", "Extract content from URLs"],
  ["chat", "Chat completion"],
  ["embed", "Create text embeddings"],
  ["vl-embed", "Create multimodal embeddings"],
  ["configure-mcp", "Configure the Octen MCP server in AI clients"],
  ["configure-skills", "Install Octen Agent Skills into AI clients"],
  ["reset", "Remove Octen MCP/skills from AI clients"],
] as const) {
  program.command(name).description(desc).action(() => {
    console.error(`'${name}' not yet implemented`);
    process.exit(1);
  });
}

program.parseAsync();
```

Note: when `dist/`, `pkg` path resolves to `../package.json` from `dist/cli.js`. During tests we run `src/cli.ts` via tsx, so `../package.json` resolves from `src/` — also correct (repo root).

**Step 4: Run to verify it passes** — Run: `npx vitest run test/cli.test.ts`. Expected: PASS.

**Step 5: Commit**
```bash
git add src/cli.ts test/cli.test.ts && git commit -m "feat: cli entry with version + command stubs"
```

---

## Phase 1 — API client core

### Task 1.1: constants

**Files:** Create `src/api/constants.ts`

```ts
export const DEFAULT_BASE_URL = "https://api.octen.ai";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 3;

export const ENDPOINTS = {
  search: "/search",
  extract: "/extract",
  embedding: "/embedding",
  vlEmbedding: "/vl-embedding",
  chat: "/v1/chat/completions",
} as const;

export const EMBEDDING_MODELS: Record<string, string> = {
  "0.6b": "octen-embedding-0.6b",
  "4b": "octen-embedding-4b",
  "8b": "octen-embedding-8b",
};
export const VL_EMBEDDING_MODELS: Record<string, string> = {
  base: "octen-vl-embedding",
  large: "octen-vl-embedding-large",
};

export const LIMITS = {
  searchCount: { min: 1, max: 100 },
  includeText: 5,
  excludeText: 5,
  extractUrls: { min: 1, max: 20 },
  extractTimeout: { min: 1, max: 60 },
  cacheWindow: { min: 300, max: 31_536_000, default: 86_400 },
} as const;

// Skills (configure-skills)
export const SKILLS_REPO = "Octen-Team/web-search-skills";
export const SKILLS_REPO_TARBALL = (ref: string) =>
  `https://github.com/${SKILLS_REPO}/archive/${ref}.tar.gz`;
```

**Commit:** `git add src/api/constants.ts && git commit -m "feat(api): constants"`

### Task 1.2: error types

**Files:** Create `src/api/errors.ts`; Test `test/api/errors.test.ts`

**Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { OctenAuthError, OctenValidationError, OctenAPIError, exitCodeFor } from "../../src/api/errors.js";

describe("errors", () => {
  it("maps error classes to exit codes", () => {
    expect(exitCodeFor(new OctenAuthError("no key"))).toBe(2);
    expect(exitCodeFor(new OctenValidationError("bad"))).toBe(2);
    expect(exitCodeFor(new OctenAPIError("boom", 500))).toBe(1);
    expect(exitCodeFor(new Error("other"))).toBe(1);
  });
});
```

**Step 2: Run → FAIL.** Run: `npx vitest run test/api/errors.test.ts`

**Step 3: Implement** (`src/api/errors.ts`)
```ts
export class OctenError extends Error {}
export class OctenAuthError extends OctenError {}
export class OctenValidationError extends OctenError {}
export class OctenTimeoutError extends OctenError {}
export class OctenAPIError extends OctenError {
  constructor(message: string, public status: number, public body?: unknown) { super(message); }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof OctenAuthError || err instanceof OctenValidationError) return 2;
  return 1;
}
```

**Step 4: Run → PASS. Step 5: Commit**
```bash
git add src/api/errors.ts test/api/errors.test.ts && git commit -m "feat(api): typed errors + exit codes"
```

### Task 1.3: HTTP client with retry

**Files:** Create `src/api/client.ts`; Test `test/api/client.test.ts`

**Step 1: Failing test** (mock `fetch`)
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OctenClient } from "../../src/api/client.js";
import { OctenAPIError } from "../../src/api/errors.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OctenClient.request", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends x-api-key and posts JSON to the base url", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const c = new OctenClient({ apiKey: "k", baseUrl: "https://api.octen.ai" });
    const out = await c.request("/search", { query: "x" });
    expect(out).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.octen.ai/search");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as any).headers["x-api-key"]).toBe("k");
    expect(JSON.parse((init as any).body)).toEqual({ query: "x" });
  });

  it("retries on 503 then succeeds", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ msg: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const c = new OctenClient({ apiKey: "k", maxRetries: 2, retryBaseMs: 0 });
    expect(await c.request("/search", {})).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("throws OctenAPIError on non-retryable 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ msg: "bad param" }, 400));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toBeInstanceOf(OctenAPIError);
  });

  it("uses Authorization Bearer for the chat endpoint", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const c = new OctenClient({ apiKey: "k" });
    await c.request("/v1/chat/completions", { model: "m", messages: [] });
    expect((spy.mock.calls[0][1] as any).headers["Authorization"]).toBe("Bearer k");
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** (`src/api/client.ts`)
```ts
import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, ENDPOINTS } from "./constants.js";
import { OctenAPIError, OctenTimeoutError } from "./errors.js";

export interface OctenClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OctenClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryBaseMs: number;

  constructor(opts: OctenClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
  }

  private headers(endpoint: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    // Chat is OpenAI-compatible -> Bearer; everything else -> x-api-key.
    if (endpoint === ENDPOINTS.chat) h["Authorization"] = `Bearer ${this.apiKey}`;
    else h["x-api-key"] = this.apiKey;
    return h;
  }

  async request<T = unknown>(endpoint: string, body: unknown, timeoutMs?: number): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs ?? this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
          method: "POST",
          headers: this.headers(endpoint),
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (res.ok) return (await res.json()) as T;
        const errBody = await res.json().catch(() => ({}));
        if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
          await sleep(this.retryBaseMs * 2 ** attempt);
          continue;
        }
        const msg = (errBody as any)?.msg ?? (errBody as any)?.error ?? `HTTP ${res.status}`;
        throw new OctenAPIError(msg, res.status, errBody);
      } catch (e) {
        if (e instanceof OctenAPIError) throw e;
        if ((e as Error).name === "AbortError") { lastErr = new OctenTimeoutError("request timed out"); }
        else lastErr = e;
        if (attempt < this.maxRetries) { await sleep(this.retryBaseMs * 2 ** attempt); continue; }
        throw lastErr;
      } finally {
        clearTimeout(t);
      }
    }
    throw lastErr;
  }

  /** Returns the raw Response for SSE streaming (chat). */
  async stream(endpoint: string, body: unknown, timeoutMs?: number): Promise<Response> {
    const ac = new AbortController();
    if (timeoutMs ?? this.timeoutMs) setTimeout(() => ac.abort(), timeoutMs ?? this.timeoutMs);
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: this.headers(endpoint),
      body: JSON.stringify({ ...(body as object), stream: true }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new OctenAPIError((errBody as any)?.msg ?? `HTTP ${res.status}`, res.status, errBody);
    }
    return res;
  }
}
```

**Step 4: Run → PASS. Step 5: Commit**
```bash
git add src/api/client.ts test/api/client.test.ts && git commit -m "feat(api): http client with retry + per-endpoint auth"
```

---

## Phase 2 — Config resolution

### Task 2.1: resolve api key + base url

**Files:** Create `src/config/resolve.ts`; Test `test/config/resolve.test.ts`

**Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { resolveApiKey, resolveBaseUrl } from "../../src/config/resolve.js";
import { OctenAuthError } from "../../src/api/errors.js";

describe("resolve", () => {
  it("prefers --api-key flag over env", () => {
    expect(resolveApiKey("flagkey", { OCTEN_API_KEY: "envkey" })).toBe("flagkey");
  });
  it("falls back to env", () => {
    expect(resolveApiKey(undefined, { OCTEN_API_KEY: "envkey" })).toBe("envkey");
  });
  it("throws OctenAuthError when missing", () => {
    expect(() => resolveApiKey(undefined, {})).toThrow(OctenAuthError);
  });
  it("resolves base url flag > env > default", () => {
    expect(resolveBaseUrl("https://f", {})).toBe("https://f");
    expect(resolveBaseUrl(undefined, { OCTEN_API_URL: "https://e" })).toBe("https://e");
    expect(resolveBaseUrl(undefined, {})).toBe("https://api.octen.ai");
  });
});
```

**Step 2: Run → FAIL. Step 3: Implement** (`src/config/resolve.ts`)
```ts
import { DEFAULT_BASE_URL } from "../api/constants.js";
import { OctenAuthError } from "../api/errors.js";

export function resolveApiKey(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const key = flag || env.OCTEN_API_KEY;
  if (!key) {
    throw new OctenAuthError(
      "No API key. Pass --api-key or set OCTEN_API_KEY. Get one at https://octen.ai",
    );
  }
  return key;
}

export function resolveBaseUrl(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  return flag || env.OCTEN_API_URL || DEFAULT_BASE_URL;
}
```

**Step 4: Run → PASS. Step 5: Commit**
```bash
git add src/config/resolve.ts test/config/resolve.test.ts && git commit -m "feat(config): api-key + base-url resolution"
```

---

## Phase 3 — Output rendering core

### Task 3.1: output mode + emit

**Files:** Create `src/output/render.ts`; Test `test/output/render.test.ts`

**Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { chooseMode } from "../../src/output/render.js";

describe("chooseMode", () => {
  it("forces json when --json", () => expect(chooseMode({ json: true }, true)).toBe("json"));
  it("forces pretty when --pretty", () => expect(chooseMode({ pretty: true }, false)).toBe("pretty"));
  it("pretty on tty by default", () => expect(chooseMode({}, true)).toBe("pretty"));
  it("json when piped by default", () => expect(chooseMode({}, false)).toBe("json"));
});
```

**Step 2: Run → FAIL. Step 3: Implement** (`src/output/render.ts`)
```ts
export type OutputMode = "pretty" | "json";

export function chooseMode(opts: { json?: boolean; pretty?: boolean }, isTty: boolean): OutputMode {
  if (opts.json) return "json";
  if (opts.pretty) return "pretty";
  return isTty ? "pretty" : "json";
}

export function emit(data: unknown, mode: OutputMode, prettyFn: (d: any) => string): void {
  if (mode === "json") process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(prettyFn(data) + "\n");
}
```

**Step 4: Run → PASS. Step 5: Commit**
```bash
git add src/output/render.ts test/output/render.test.ts && git commit -m "feat(output): tty-aware mode selection + emit"
```

### Task 3.2: top-level error handler in cli.ts

**Files:** Modify `src/cli.ts`

Wrap `program.parseAsync()` so thrown `OctenError`s print to stderr (red, via picocolors) and exit with `exitCodeFor(err)`. Add:
```ts
import pc from "picocolors";
import { exitCodeFor } from "./api/errors.js";

program.parseAsync().catch((err) => {
  process.stderr.write(pc.red(`error: ${(err as Error).message}\n`));
  process.exit(exitCodeFor(err));
});
```
Commit: `git add src/cli.ts && git commit -m "feat(cli): top-level error handler"`

---

## Phase 4 — `search` (+ `news`) — reference vertical slice

This phase establishes the pattern every later command follows: **api method → request builder + client-side validation → command wiring → pretty renderer → tests**.

### Task 4.1: search request builder + validation

**Files:** Create `src/api/search.ts`; Test `test/api/search.test.ts`

**Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { buildSearchRequest } from "../../src/api/search.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildSearchRequest", () => {
  it("includes only provided fields", () => {
    expect(buildSearchRequest("hi", { count: 5, topic: "news" }))
      .toEqual({ query: "hi", count: 5, topic: "news" });
  });
  it("rejects count out of range", () => {
    expect(() => buildSearchRequest("hi", { count: 0 })).toThrow(OctenValidationError);
    expect(() => buildSearchRequest("hi", { count: 101 })).toThrow(OctenValidationError);
  });
  it("rejects >5 include-text", () => {
    expect(() => buildSearchRequest("hi", { includeText: ["a","b","c","d","e","f"] })).toThrow(OctenValidationError);
  });
  it("maps highlight flags into a nested object", () => {
    expect(buildSearchRequest("hi", { highlight: true, highlightMaxTokens: 300 }))
      .toMatchObject({ highlight: { enable: true, max_tokens: 300 } });
  });
});
```

**Step 2: Run → FAIL. Step 3: Implement** (`src/api/search.ts`)
```ts
import { LIMITS } from "./constants.js";
import { OctenValidationError } from "./errors.js";

export interface SearchOpts {
  topic?: "general" | "news";
  count?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  timeBasis?: "auto" | "published" | "crawled";
  timeRange?: string;
  startTime?: string;
  endTime?: string;
  format?: "text" | "markdown";
  safesearch?: "off" | "strict";
  highlight?: boolean;
  highlightMaxTokens?: number;
  fullContent?: boolean;
  fullContentMaxTokens?: number;
  images?: boolean;
  videos?: boolean;
}

export function buildSearchRequest(query: string, o: SearchOpts): Record<string, unknown> {
  if (!query) throw new OctenValidationError("query is required");
  if (o.count != null && (o.count < LIMITS.searchCount.min || o.count > LIMITS.searchCount.max))
    throw new OctenValidationError(`count must be ${LIMITS.searchCount.min}-${LIMITS.searchCount.max}`);
  if (o.includeText && o.includeText.length > LIMITS.includeText)
    throw new OctenValidationError(`include-text max ${LIMITS.includeText}`);
  if (o.excludeText && o.excludeText.length > LIMITS.excludeText)
    throw new OctenValidationError(`exclude-text max ${LIMITS.excludeText}`);

  const req: Record<string, unknown> = { query };
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };
  put("topic", o.topic); put("count", o.count);
  put("include_domains", o.includeDomains); put("exclude_domains", o.excludeDomains);
  put("include_text", o.includeText); put("exclude_text", o.excludeText);
  put("time_basis", o.timeBasis); put("time_range", o.timeRange);
  put("start_time", o.startTime); put("end_time", o.endTime);
  put("format", o.format); put("safesearch", o.safesearch);
  put("include_images", o.images); put("include_videos", o.videos);
  if (o.highlight) req.highlight = { enable: true, ...(o.highlightMaxTokens ? { max_tokens: o.highlightMaxTokens } : {}) };
  if (o.fullContent) req.full_content = { enable: true, ...(o.fullContentMaxTokens ? { max_tokens: o.fullContentMaxTokens } : {}) };
  return req;
}
```

**Step 4: Run → PASS. Step 5: Commit**
```bash
git add src/api/search.ts test/api/search.test.ts && git commit -m "feat(api): search request builder + validation"
```

### Task 4.2: search pretty renderer

**Files:** Create `src/output/pretty/search.ts`; Test `test/output/pretty/search.test.ts`

**Step 1: Failing test** — assert the rendered string contains the index, title, url, and a snippet for each result. Use a fixture response `{ results: [{ title, url, highlight }] }`. Keep assertions on substrings (not exact ANSI).

**Step 3: Implement** — iterate `data.results`, print `${i+1}. ${pc.bold(title)}` line, dim `url`, indented snippet (`highlight` || `full_content` truncated). Return the joined string.

**Step 5: Commit** `feat(output): search pretty renderer`

### Task 4.3: wire `search` + `news` commands

**Files:** Modify `src/cli.ts` (replace the `search`/`news` stubs); Create `src/commands/search.ts`; Test `test/commands/search.test.ts`

**Step 3: Implement** (`src/commands/search.ts`)
```ts
import type { Command } from "commander";
import { OctenClient } from "../api/client.js";
import { ENDPOINTS } from "../api/constants.js";
import { buildSearchRequest, type SearchOpts } from "../api/search.js";
import { resolveApiKey, resolveBaseUrl } from "../config/resolve.js";
import { chooseMode, emit } from "../output/render.js";
import { renderSearch } from "../output/pretty/search.js";

export function registerSearch(program: Command, fixedTopic?: "news") {
  const cmd = program.command(fixedTopic ? "news" : "search")
    .argument("<query>", "search query")
    .description(fixedTopic ? "News-focused web search" : "Search the live web")
    .option("-n, --count <n>", "results 1-100", (v) => parseInt(v, 10))
    .option("--include-domains <list>", "comma list", (v) => v.split(","))
    .option("--exclude-domains <list>", "comma list", (v) => v.split(","))
    .option("--include-text <list>", "comma list", (v) => v.split(","))
    .option("--exclude-text <list>", "comma list", (v) => v.split(","))
    .option("--time-basis <b>").option("--time-range <r>")
    .option("--start-time <iso>").option("--end-time <iso>")
    .option("--format <f>", "text|markdown").option("--safesearch <s>", "off|strict")
    .option("--highlight").option("--highlight-max-tokens <n>", "", (v) => parseInt(v, 10))
    .option("--full-content").option("--full-content-max-tokens <n>", "", (v) => parseInt(v, 10))
    .option("--images").option("--videos");
  if (!fixedTopic) cmd.option("--topic <t>", "general|news");

  cmd.action(async (query: string, opts: any, command: Command) => {
    const g = command.optsWithGlobals();
    const apiKey = resolveApiKey(g.apiKey, process.env);
    const client = new OctenClient({ apiKey, baseUrl: resolveBaseUrl(g.baseUrl, process.env) });
    const searchOpts: SearchOpts = { ...opts, topic: fixedTopic ?? opts.topic };
    const req = buildSearchRequest(query, searchOpts);
    const res = await client.request(ENDPOINTS.search, req);
    emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderSearch);
  });
}
```

In `src/cli.ts`: define global options once (`--api-key`, `--base-url`, `--json`, `--pretty`, `--no-color`) on `program`, remove the `search`/`news` stubs, and call `registerSearch(program)` + `registerSearch(program, "news")`.

**Step 1 (test):** `test/commands/search.test.ts` — mock `fetch`, run the action via `program.parseAsync(["node","octen","search","hi","--json","--api-key","k"])` capturing stdout; assert the POSTed body and that stdout is valid JSON. (Set `process.env.OCTEN_API_KEY` unset; pass `--api-key`.)

**Step 5: Commit** `feat(cmd): search + news commands`

---

## Phase 5 — `fetch` (extract)

Mirror Phase 4. **Files:** `src/api/extract.ts`, `src/output/pretty/extract.ts`, `src/commands/fetch.ts` + tests.

- **Request builder** `buildExtractRequest(urls: string[], o)` → body `{ urls, query?, max_age_seconds?, format?, timeout?, include_images?, include_videos?, include_audio?, include_favicon? }`. Validate: 1–20 URLs (`LIMITS.extractUrls`), `--fetch-timeout` 1–60, clamp `--max-age` into `[300, 31_536_000]`. Auto-prefix bare hosts with `https://`.
- **Flags:** `--query`, `--max-age <sec>`, `--format markdown|text`, `--fetch-timeout <1-60>`, `--images`/`--videos`/`--audio`/`--favicon`.
- **Renderer:** per-URL block — `status`, `category.primary/secondary`, `page_structure.primary/secondary`, `title`, then `highlights[]` or truncated `full_content`. Render `status: failed` results in red with `error_message`.
- **Tests:** builder validation (0 urls, 21 urls, clamp); renderer shows failed vs success differently.
- **Commit per task** as in Phase 4.

---

## Phase 6 — `chat` (streaming + REPL)

**Files:** `src/api/chat.ts`, `src/api/sse.ts`, `src/commands/chat.ts`, `src/output/pretty/chat.ts` + tests.

### Task 6.1: chat request builder
`buildChatRequest(messages, model, o)` → `{ model, messages, web_search?, max_tokens?, temperature?, top_p?, reasoning?: {effort}, stop?, seed?, frequency_penalty?, presence_penalty? }`. Require `model` (else `OctenValidationError` pointing at `--model`/`OCTEN_CHAT_MODEL`). Test field mapping + reasoning nesting.

### Task 6.2: SSE parser
`async function* parseSSE(res: Response): AsyncIterable<any>` — read `res.body!` via `getReader()`, decode, split on `\n\n`, strip `data: `, `JSON.parse`, skip `[DONE]`. Test with a fake `Response` built from a `ReadableStream` of two `data:` chunks; assert yielded objects.

### Task 6.3: chat command
- One-shot: `octen chat "..."`; prompt from positional arg, or stdin if piped, or `-i` REPL.
- Flags: `-m/--model`, `--system`, `--web-search`, `--temperature`, `--top-p`, `--max-tokens`, `--reasoning-effort`, `--stop`, `--seed`, `--stream/--no-stream` (default: stream when TTY).
- Streaming: call `client.stream(ENDPOINTS.chat, req)`, iterate `parseSSE`, write `choices[0].delta.content` to stdout as it arrives; print dim usage footer at end.
- Non-stream / `--json`: `client.request(...)`, emit full `ChatCompletion`.
- REPL (`-i`): loop reading lines (`node:readline`), maintain `messages` history, `/exit` quits, `/reset` clears history.
- Tests: mock `fetch` to return SSE body; assert concatenated streamed text. Mock for non-stream JSON path.

**Commit per task.**

---

## Phase 7 — `embed`

**Files:** `src/api/embedding.ts`, `src/commands/embed.ts`, `src/output/pretty/embedding.ts` + tests.

- **Builder** `buildEmbeddingRequest(input: string|string[], o)` → `{ input, model?, dimension?, input_type?, truncation? }`. Map `-m 0.6b|4b|8b` via `EMBEDDING_MODELS` (pass through full ids unchanged).
- **Input sources:** positional args, `--file <path>` (one text per line), or stdin. Precedence: args > file > stdin.
- **Flags:** `-m/--model`, `--dimension`, `--input-type query|document`, `--truncation/--no-truncation`.
- **Renderer:** table — `#`, `dims` (vector length), `model`, plus a footer hint "use --json for raw vectors". `--json` emits the full response (with vectors).
- **Tests:** model shortcut mapping; input precedence; renderer shows dims not raw floats.

---

## Phase 8 — `vl-embed`

**Files:** `src/api/vlEmbedding.ts`, `src/commands/vlEmbed.ts`, `src/output/pretty/vlEmbedding.ts` + tests.

- **Content parsing:** positional tokens `type:value`, e.g. `text:"a cat" image:./cat.jpg video:https://...`. Parse each into `{ text|image|video: value }`, preserving order. Reject tokens without a known prefix (`OctenValidationError`). Enforce ≤20 contents, ≤5 images, ≤1 video.
- **Builder** `buildVlEmbeddingRequest(contents, model, o)` → `{ model, input: { contents }, enable_fusion?, dimension?, fps?, instruct? }`. Map `-m base|large` via `VL_EMBEDDING_MODELS`.
- **Flags:** `-m/--model`, `--fusion`, `--dimension`, `--fps`, `--instruct`.
- **Local files:** for `image:`/`video:` that are local paths, read + base64 data-URI encode. (Confirm `/vl-embedding` accepts data URIs — design §13; if not, restrict to URLs and error on local paths.)
- **Renderer:** table — `#`, `dims`, `type` (`fusion`|`vl`), `model`.
- **Tests:** token parsing + order; limits; model shortcut; data-URI for local file.

---

## Phase 9 — `configure-mcp`

**Files:** `src/mcp/clients.ts`, `src/mcp/detect.ts`, `src/commands/configureMcp.ts` + tests.

### Task 9.1: client registry
`src/mcp/clients.ts` exports an array of client descriptors:
```ts
export interface McpClient {
  id: "claude-code" | "claude-desktop" | "cursor" | "windsurf" | "vscode" | "codex";
  label: string;
  format: "json-mcpServers" | "json-servers" | "toml" | "claude-code";
  pathFor(scope: "user" | "project", home: string, cwd: string): string;
  supportsProject: boolean;
}
```
Paths (from design §8): claude-code → `~/.claude.json` (user); claude-desktop → `~/Library/Application Support/Claude/claude_desktop_config.json`; cursor → `~/.cursor/mcp.json` | `.cursor/mcp.json`; windsurf → `~/.codeium/windsurf/mcp_config.json`; vscode → `.vscode/mcp.json`; codex → `~/.codex/config.toml`. Test each path resolution against a fake `home`/`cwd`.

### Task 9.2: merge-safe writer
`upsertMcpServer(filePath, format, entry)` — read existing config (or `{}`), insert/replace `octen` under the right key (`mcpServers` / `servers` / TOML `mcp_servers.octen`), preserve all other entries, write back. Idempotent. Test: pre-seed a file with another server, assert it survives and `octen` is added/updated. The entry value: `{ command: "npx", args: ["-y","octen-mcp"], env: { OCTEN_API_KEY: key ?? "${OCTEN_API_KEY}" } }`.

### Task 9.3: claude-code path
When `id === "claude-code"`: if `which claude` succeeds, shell out `claude mcp add --scope user octen -e OCTEN_API_KEY=<key> -- npx -y octen-mcp`; else merge-edit `~/.claude.json` `mcpServers.octen`. (This covers CLI + desktop app — design §8.) Test the fallback path with a temp `~/.claude.json`.

### Task 9.4: command + status mode
Flags: `--all`, per-client booleans, `--scope`, `--pin <ver>`. No flags → detect installed clients (file exists / dir exists) and print a status table (configured/not). With flags → write for each selected client, print confirmation + the per-client `OCTEN_API_KEY` reminder if no key resolved.

**Commit per task.** Use a temp `HOME` env in tests (`vi.stubEnv` / pass `home` explicitly).

---

## Phase 10 — `configure-skills` (remote-first + offline fallback)

**Files:** `src/skills/clients.ts`, `src/skills/source.ts`, `src/skills/install.ts`, `src/skills/detect.ts`, `src/commands/configureSkills.ts`, `scripts/sync-skills.ts`, vendored `skills/` + tests.

### Task 10.1: skills-dir registry
`src/skills/clients.ts` — descriptors mapping client id → user/project skills dir (design §9): claude-code `~/.claude/skills` | `.claude/skills`; cursor `~/.cursor/skills` | `.cursor/skills`; codex `~/.codex/skills`; openclaw `~/.openclaw/skills`; hermes `~/.hermes/skills`; plus `--skills-dir <path>` override. Test path resolution.

### Task 10.2: skill source (remote-first, bundled fallback)
`src/skills/source.ts`:
```ts
// Returns a local directory containing skill subdirs (octen-web-search/, octen-search/).
export async function resolveSkillsDir(opts: { ref: string; offline: boolean; cacheDir: string; bundledDir: string; }): Promise<{ dir: string; source: "remote" | "cache" | "bundled" }>;
```
- If `offline` → return `bundledDir` (`source: "bundled"`).
- Else download `SKILLS_REPO_TARBALL(ref)`, extract to `cacheDir/<ref>/` (strip `web-search-skills-*/skills/`), return it (`source: "remote"`). Use Node's built-in: `fetch` → buffer → `node:zlib` gunzip → `tar` extraction. (Add a tiny `tar` dep if extraction in pure node is painful — `tar` is acceptable.)
- On any network error → fall back to `bundledDir` with a warning (`source: "bundled"`).
- Test: mock `fetch` to throw → expect bundled fallback. Mock success with a small tarball fixture → expect extracted dir.

### Task 10.3: installer (merge-safe + version marker)
`installSkills(srcDir, targetSkillsDir, only?)` — for each `octen-*` subdir in `srcDir` (optionally filtered by `--only`), copy recursively into `targetSkillsDir/<name>/` (overwrite), preserving `scripts/`/asset subdirs, and write `<name>/.octen-version` (ref/commit). Only touches `octen-*` dirs. Test: pre-seed an unrelated skill dir, assert it survives; assert `.octen-version` written.

### Task 10.4: command + status + sync-skills script
- Flags (design §9): `--all`, per-client, `--skills-dir`, `--scope`, `--only`, `--ref` (default `main`), `--bundled`/`--offline`, `--force`. No flags → status mode comparing bundled/installed versions via `.octen-version`.
- After install: print per-client `OCTEN_API_KEY` setup line; `--set-key` writes Claude Code `~/.claude/settings.json` `env`.
- `scripts/sync-skills.ts`: download upstream tarball at a pinned ref → write into vendored `skills/` + `skills/manifest.json` (records ref/commit). Run manually at release time.
- Vendor an initial `skills/` copy now (so offline fallback works on first publish): copy the two upstream skills in and commit.

**Commit per task.**

---

## Phase 11 — `reset`

**Files:** `src/commands/reset.ts` + tests. Reuses `src/mcp/*` and `src/skills/*`.

- Flags: `--mcp`, `--skills`, `--all`, per-client, `--scope`.
- `--mcp`: for each selected client, remove the `octen` key from the MCP config (or `claude mcp remove octen`), preserving other servers. Idempotent (no-op if absent).
- `--skills`: delete `octen-*` skill dirs from the client's skills dir. Only `octen-*`.
- Tests: pre-seed configs/dirs with octen + a sibling; assert only octen removed.

**Commit per task.**

---

## Phase 12 — Packaging & docs

### Task 12.1: build smoke test
Run `npm run build`; assert `dist/cli.js` exists and `node dist/cli.js --help` lists all commands. Commit.

### Task 12.2: README
Write `README.md`: install (`npm i -g octen-cli` / `npx octen`), `OCTEN_API_KEY` setup, one example per command, `configure-mcp`/`configure-skills` usage, the update model (MCP auto via npx; skills auto via re-running `configure-skills`). Commit.

### Task 12.3: LICENSE (MIT)
Add MIT `LICENSE` (author Octen). Commit.

---

## Done criteria
- `npm test` green; `npm run build` produces a working `dist/cli.js`.
- Every command works against the live API with `OCTEN_API_KEY` set (manual smoke).
- `configure-mcp --all` / `configure-skills --all` write correct, merge-safe configs; `reset --all` cleanly removes only octen entries.
- Skills install fetches latest from upstream by default and falls back to the bundled copy offline.
