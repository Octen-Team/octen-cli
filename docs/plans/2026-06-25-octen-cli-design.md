# octen CLI — Design

- **Date:** 2026-06-25
- **Status:** Approved (brainstorming complete; next step = implementation plan)
- **Reference:** modeled structurally on the keenable CLI (`https://docs.keenable.ai/cli`)

## 1. Goal & context

A first-party command-line tool for [Octen](https://octen.ai) that mirrors the structure of the keenable CLI but exposes Octen's full API surface, plus one-command setup of Octen's MCP server and Agent Skills across AI coding clients.

Octen already has:
- `octen-py` — mature Python SDK (v0.5.0), wraps all 5 APIs (search, extract, text embedding, VL embedding, chat).
- `octen-mcp` — TypeScript MCP server (npm `octen-mcp`), exposes search + extract as MCP tools.
- `Octen-Team/web-search-skills` — Agent Skills repo shipping two skills (`octen-web-search` → `/search`, `octen-search` → `/broad-search`).

The CLI is a new package; it does not modify `octen-mcp` or `octen-py`.

## 2. Key decisions

| Decision | Choice |
|---|---|
| Runtime | TypeScript / Node (ESM, Node ≥ 18, native `fetch`) |
| Distribution | npm — package `octen-cli`, binary `octen`; `npx octen …` / `npm i -g octen-cli` |
| Code structure | Self-contained package; `src/api/` written so it can later graduate into a shared `@octen/sdk` |
| Auth | Read `OCTEN_API_KEY` from env, with `--api-key` override per command. No `login`/`logout`, no stored credentials |
| Output | Pretty-on-TTY, JSON-on-pipe; `--json` / `--pretty` force a mode |
| Skill delivery | **Fetch latest from upstream on each `configure-skills` run** (new skills need no CLI upgrade); bundled vendored copy is the offline fallback |

## 3. Command surface

**Global flags** (all commands): `--api-key <key>`, `--base-url <url>`, `--json`, `--pretty`, `--no-color`, `-q/--quiet`, `-V/--version`, `-h/--help`.

| Command | Maps to | Key flags |
|---|---|---|
| `octen search <query>` | `POST /search` | `-n/--count` (1–100), `--topic general\|news`, `--include-domains`/`--exclude-domains`, `--include-text`/`--exclude-text` (≤5), `--time-basis`, `--time-range`, `--start-time`/`--end-time`, `--format text\|markdown`, `--safesearch`, `--highlight [--highlight-max-tokens]`, `--full-content [--full-content-max-tokens]`, `--images`, `--videos` |
| `octen news <query>` | `POST /search` (`topic=news`) | thin alias of `search`; mirrors octen-mcp's `news_search` |
| `octen fetch <url...>` | `POST /extract` (1–20 URLs) | `--query` (→ highlights), `--max-age <sec>` (clamp 300–31536000), `--format markdown\|text`, `--fetch-timeout <1–60>`, `--images`/`--videos`/`--audio`/`--favicon` |
| `octen chat [prompt]` | `POST /v1/chat/completions` | `-m/--model` (required, or `OCTEN_CHAT_MODEL`), `--system`, `--web-search on\|off`, `--temperature`, `--top-p`, `--max-tokens`, `--reasoning-effort low\|medium\|high`, `--stop`, `--seed`, `--stream/--no-stream` (stream default on TTY), `-i/--interactive` REPL |
| `octen embed <text...>` | `POST /embedding` | `-m/--model 0.6b\|4b\|8b\|<id>`, `--dimension`, `--input-type query\|document`, `--truncation/--no-truncation`; input via args / `--file` / stdin |
| `octen vl-embed <content...>` | `POST /vl-embedding` | content as ordered `text:…`/`image:…`/`video:…` tokens, `-m/--model base\|large\|<id>`, `--fusion`, `--dimension`, `--fps`, `--instruct` |
| `octen configure-mcp` | writes MCP client configs | see §8 |
| `octen configure-skills` | installs bundled Agent Skills | see §9 |
| `octen reset` | uninstall | `--mcp` / `--skills` / `--all`; per-client flags; removes only `octen` entries |

Notes:
- `chat --model` is required (the SDK has no default model); falls back to `OCTEN_CHAT_MODEL`.
- `vl-embed` uses ordered `type:value` tokens so text/image/video interleave correctly (commander loses cross-flag ordering).
- `login`/`logout` are intentionally absent (env-var-only auth).

## 4. Architecture / module layout

```
octen-cli/
  package.json                  # bin: { octen: dist/cli.js }
  tsconfig.json
  skills/                       # vendored bundled skills (octen-web-search, octen-search)
    manifest.json               #   per-skill source commit/version
  scripts/sync-skills.ts        # refresh vendored skills from upstream repo (maintainer tool)
  src/
    cli.ts                      # commander program, global opts, dispatch
    commands/                   # one file per command (thin: parse -> api -> render)
      search.ts fetch.ts chat.ts embed.ts vlEmbed.ts
      configureMcp.ts configureSkills.ts reset.ts
    api/                        # portable client (future @octen/sdk)
      client.ts                 #   OctenClient.request() + streamRequest() (SSE)
      search.ts extract.ts chat.ts embedding.ts vlEmbedding.ts
      types.ts errors.ts constants.ts
    config/resolve.ts           # api-key / base-url resolution (flag > env)
    mcp/
      clients.ts                # per-client config path + format + read/merge/write
      detect.ts                 # detect installed MCP clients + octen status
    skills/
      clients.ts                # skills-dir registry per client/scope
      install.ts                # copy bundled skill -> target (merge-safe, idempotent)
      detect.ts                 # detect agents + octen-* skill status/version
    output/
      render.ts                 # TTY detection, pretty vs json dispatch
      pretty/                   # per-command pretty renderers
    util/                       # stdin, color, spinner
  test/
```

## 5. API client layer

- `OctenClient(apiKey, baseUrl, timeout, maxRetries)` over native `fetch`. Base URL `https://api.octen.ai` (override `OCTEN_API_URL` / `--base-url`).
- **Headers mirror `octen-py`:** `x-api-key` for `/search`, `/embedding`, `/vl-embedding`, `/extract`. The chat endpoint (`/v1/chat/completions`, OpenAI-compatible) accepts `x-api-key` or `Authorization: Bearer` — confirm and encapsulate per-endpoint during implementation.
- Retry with exponential backoff on 429/5xx (3 retries, matching the SDK).
- Streaming: SSE parsing for `chat --stream` via the response `ReadableStream`.
- Client-side validation mirrors the documented SDK limits (count 1–100, ≤5 include/exclude-text, 1–20 URLs, dimension caps, etc.) so users get fast, clear errors before any network call.

## 6. Auth & config resolution

- Per invocation: `--api-key` flag → `OCTEN_API_KEY` env. No file storage.
- Base URL: `--base-url` → `OCTEN_API_URL` → `https://api.octen.ai`.
- API commands with no resolved key exit with code 2 and a clear message ("set `OCTEN_API_KEY` or pass `--api-key`; get a key at octen.ai"). `configure-*` run without a key (write a `${OCTEN_API_KEY}` placeholder + warn).

## 7. Output rendering

- `process.stdout.isTTY && !--json` → **pretty** (colored via picocolors); piped or `--json` → **raw JSON** (the API response object). `--pretty`/`--json` force.
- Per command: search → ranked list (idx, title, url, snippet/highlight); fetch → per-URL block (status, `category`, `page_structure`, title, content/highlights); chat → streamed text + dim usage footer; embed/vl-embed → table (index, dims, model, type) + hint to use `--json` for raw vectors.
- Data → stdout; human errors → stderr.

## 8. `configure-mcp`

Writes `{ command: "npx", args: ["-y","octen-mcp"], env: { OCTEN_API_KEY } }` into each client's config file/format. **Merge, don't clobber** — preserves existing `mcpServers`; idempotent.

| Client | Target |
|---|---|
| **Claude Code (CLI + desktop app)** | shared config home: prefer `claude mcp add --scope user octen -e OCTEN_API_KEY=… -- npx -y octen-mcp` when the `claude` binary is on PATH; else merge-edit `~/.claude.json` → `mcpServers.octen` directly (more robust; the desktop app may not expose `claude` on PATH) |
| **Claude Desktop (chat app)** | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| **Cursor** | `~/.cursor/mcp.json` (user) / `.cursor/mcp.json` (project) |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **VS Code** | `.vscode/mcp.json` (project) / user settings |
| **Codex** | `~/.codex/config.toml` (TOML) |

Flags: `--all`, per-client (`--claude-code`/`--cursor`/`--claude-desktop`/`--windsurf`/`--vscode`/`--codex`), `--scope user|project`, `--pin <ver>` (default unpinned `octen-mcp` = auto-latest). No flags → status mode (detected clients + octen status).

### `--claude-code` dual-surface

The Claude Code **CLI and desktop app share the same config home** (the desktop app bundles the same `claude` engine, e.g. `~/Library/Application Support/Claude/claude-code/<ver>/claude.app`, and reads `~/.claude.json` for MCP + `~/.claude/` for skills/settings). So one write covers both. Kept distinct from `--claude-desktop` (the chat app, which does not consume `~/.claude/skills`).

> **Caveat to verify at implementation:** the desktop app's full-VM-sandbox "cowork" mode (`claude-code-vm`, `lastSeenRequireCoworkFullVmSandbox`) may run in an isolated VM that does not see host `~/.claude.json`. Standard mode shares host config. Add a separate injection path only if verification shows it is needed.

## 9. `configure-skills`

Installs Octen's bundled Agent Skills into any client following the [agentskills.io](https://agentskills.io) standard — the skills analogue of `configure-mcp`.

**Skill source & delivery (remote-first):**
- **Default — fetch latest from upstream.** Each `configure-skills` run downloads the current skills from `Octen-Team/web-search-skills` (the `archive/<ref>.tar.gz` tarball, same mechanism as the repo's curl install) and copies them into the target. This means **new/updated skills reach users without a CLI upgrade** — the CLI version and the skill catalog are decoupled.
- **Offline fallback — bundled copy.** The package still vendors the `skills/` tree (`scripts/sync-skills.ts` + `skills/manifest.json` recording source commit/version). If the fetch fails (offline, network error, rate-limit), `configure-skills` falls back to the bundled copy with a warning.
- **Caching:** fetched skills are cached under `~/.cache/octen-cli/skills/<ref>/` to avoid re-downloading every run and to warm an offline copy.
- **Flags:** `--ref <branch|tag|commit>` (default `main`), `--bundled`/`--offline` to force the vendored copy (skip network).
- Currently shipping `octen-web-search` (`/search`) and `octen-search` (`/broad-search`). `octen-ui-design-search` is **not** in that repo; deferred until its canonical source is confirmed.

**Skills-dir matrix** (distinct from the MCP client list):

| Client | User scope | Project scope |
|---|---|---|
| Claude Code (CLI + desktop app) | `~/.claude/skills/` | `.claude/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| Codex | `~/.codex/skills/` | — |
| OpenClaw | `~/.openclaw/skills/` | — |
| Hermes | `~/.hermes/skills/` | — |
| Other (agentskills.io) | `--skills-dir <path>` | |

**Flags:** `--all`; per-client (`--claude-code`/`--cursor`/`--codex`/`--openclaw`/`--hermes`); `--skills-dir <path>`; `--scope user|project`; `--only <names>` (subset, default all available); `--ref <branch|tag|commit>` (default `main`); `--bundled`/`--offline` (force vendored copy, skip network); `--force` (overwrite without prompt). No flags → status mode.

**Behavior:** copy each bundled skill dir → `<skills-dir>/octen-<name>/` (preserving `scripts/`/asset subdirs), writing a version marker (e.g. `octen-<name>/.octen-version`). **Merge-safe:** only touches `octen-*` dirs. Idempotent (re-run overwrites octen-*). After install, print the per-client `OCTEN_API_KEY` setup line; optional `--set-key` writes it where a clean mechanism exists (Claude Code `~/.claude/settings.json` `env`).

## 10. `reset`

Single uninstaller for both surfaces: `--mcp` removes MCP server entries (§8), `--skills` removes bundled `octen-*` skill dirs (§9), `--all` does both. Per-client flags scope the removal. Removes **only** `octen`/`octen-*` entries — never touches other servers/skills.

## 11. Update & maintenance

Two distinct update channels — separate "auto-update" from "needs a release":

1. **MCP content — near zero-op (auto-closed-loop).** `configure-mcp` writes unpinned `npx -y octen-mcp`, so new/changed tools in `octen-mcp` reach users automatically on next MCP launch — no CLI or user action. Exception: a brand-new MCP *server package* needs a registry entry → new CLI release → users re-run `configure-mcp`. `--pin <ver>` is the stability escape hatch.
2. **Skill content — auto-latest on each `configure-skills` run (decoupled from CLI version).**
   - User: re-run `octen configure-skills` → it pulls the latest skills from upstream and copies them in. **No CLI upgrade needed to get new skills.**
   - Maintainer: just push to `Octen-Team/web-search-skills`; users pick it up on their next `configure-skills`. The bundled copy is only the offline fallback, refreshed at CLI-release time via `npm run sync-skills` (nice-to-have, off the critical path).
   - Offline: `octen configure-skills --bundled` installs the vendored copy without network.
3. **CLI itself:** `npm i -g octen-cli@latest`; npx is always latest. keenable-style hourly update-check deferred to v2 (`octen --version` suffices for v1).

**Make updates visible:** `configure-skills` status mode compares bundled vs installed skill versions (via the `.octen-version` markers) and lists "updatable / not installed". `octen reset --skills` + `configure-skills` = clean reinstall.

**Mental model:** MCP content auto-updates via `npx` (near zero-op); skill content auto-updates on each `configure-skills` run (fetched from upstream, no CLI upgrade needed); only a brand-new package or client requires touching the CLI registry + a CLI release.

## 12. Distribution, build, testing

- Build with `tsc` → `dist/` (ESM), shebang on `cli.js`, `npm publish`. Standalone brew binary (`bun build --compile`) and hourly update-check deferred to v2 (YAGNI for v1).
- **Testing (vitest):**
  - unit: arg→payload mapping per command, config resolution, client-side validation limits, pretty/JSON snapshots.
  - api client: `fetch`-mocked — endpoint, headers (`x-api-key` vs `Bearer`), body, retry on 429/5xx, SSE parsing for chat stream.
  - mcp/skills config: against a temp `HOME` — each client's file written/merged without clobbering; idempotency; `reset` removes only octen entries.
  - a few integration tests gated on `OCTEN_API_KEY` (skipped in CI without a key).

## 13. Open items to confirm during implementation

- Chat endpoint auth header (`x-api-key` vs `Authorization: Bearer`).
- Claude Code desktop app full-VM-sandbox cowork config path (§8 caveat).
- `vl-embed` local file handling (URL / data-URI / base64) — confirm what `/vl-embedding` accepts.
- Default `chat` model fallback value (or require explicit `--model` / `OCTEN_CHAT_MODEL`).
