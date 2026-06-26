# @octen.ai/cli

Command-line tool for Octen — web search, extract, chat, embeddings, and one-command MCP/Skills setup for Claude Code, Cursor, and more.

## Install

```sh
npm i -g @octen.ai/cli
```

Or run without installing:

```sh
npx @octen.ai/cli <command>
```

Requires Node.js 18+.

## Auth

Set your API key (get one at https://octen.ai):

```sh
export OCTEN_API_KEY=your_key_here
```

You can also pass `--api-key <key>` on any command. To point at a self-hosted or staging endpoint, set `OCTEN_API_URL` or pass `--base-url <url>`.

## Commands

### `octen search`

Search the live web.

```sh
octen search "latest LLM benchmarks" -n 10 --topic news --highlight --time-range 7d
```

Options: `-n` (result count 1–100), `--topic` (general|news), `--highlight`, `--time-range`, `--start-time`, `--end-time`, `--include-domains`, `--exclude-domains`, `--full-content`, `--images`, `--videos`, `--format` (text|markdown), `--safesearch`.

---

### `octen news`

News-focused web search (same flags as `search` minus `--topic`).

```sh
octen news "OpenAI announcement" --highlight --time-range 1d
```

---

### `octen fetch`

Extract content from one or more URLs (1–20).

```sh
octen fetch https://example.com --query "pricing" --max-age 3600 --images
```

Options: `--query` (relevance hint), `--max-age <sec>` (cache age), `--images`, `--videos`, `--audio`, `--favicon`, `--format` (markdown|text), `--fetch-timeout <sec>`.

---

### `octen chat`

Chat completion with optional streaming.

```sh
octen chat "Summarize the Octen docs" -m octen-r1
```

Streaming is on by default when output is a TTY; use `--no-stream` to get a single JSON response. Pass `-i` for interactive REPL mode. Set `OCTEN_CHAT_MODEL` to avoid specifying `-m` every time.

Options: `-m/--model`, `--system`, `--web-search` (on|off), `--temperature`, `--top-p`, `--max-tokens`, `--reasoning-effort` (low|medium|high), `--frequency-penalty`, `--presence-penalty`, `--stop`, `--seed`, `--no-stream`, `-i/--interactive`.

---

### `octen embed`

Create text embeddings.

```sh
octen embed "semantic search query" -m 4b
```

Accepts multiple positional args, `--file <path>` (one text per line), or stdin. Use `--json` (global flag) to print the raw vector array.

Options: `-m/--model` (0.6b|4b|8b or full ID), `--dimension`, `--input-type` (query|document), `--truncation`/`--no-truncation`.

---

### `octen vl-embed`

Create multimodal embeddings from text, images, and/or video.

```sh
octen vl-embed "text:a red car" "image:https://example.com/car.jpg" -m base --fusion
```

Content tokens are prefixed with `text:`, `image:`, or `video:`. Image/video values can be URLs or local file paths.

Options: `-m/--model` (base|large or full ID), `--fusion`/`--no-fusion`, `--dimension`, `--fps`, `--instruct`.

---

### `octen configure-mcp`

Configure the Octen MCP server in AI clients (merges into existing config, does not clobber).

```sh
# Configure all supported clients at once
octen configure-mcp --all

# Or pick specific clients
octen configure-mcp --claude-code --cursor

# Pin to a specific octen-mcp version
octen configure-mcp --all --pin 0.2.1
```

Supported clients: Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Codex.

Options: `--all`, `--claude-code`, `--cursor`, `--claude-desktop`, `--windsurf`, `--vscode`, `--codex`, `--scope` (user|project), `--pin <version>`.

Run without flags to print current status for each client.

---

### `octen configure-skills`

Install Octen Agent Skills into AI clients.

```sh
# Install into all supported clients (fetches latest from upstream)
octen configure-skills --all

# Use bundled skills — no network required
octen configure-skills --all --offline

# Fetch from a specific git ref
octen configure-skills --claude-code --ref v0.3.0
```

Supported clients: Claude Code, Cursor, Codex, OpenClaw, Hermes.

Options: `--all`, `--claude-code`, `--cursor`, `--codex`, `--openclaw`, `--hermes`, `--scope` (user|project), `--ref <ref>` (default: main), `--bundled`/`--offline` (use vendored skills), `--only <names>` (comma-separated skill names), `--skills-dir <path>` (custom source directory).

Run without flags to show installed skills per client.

---

### `octen reset`

Remove the Octen MCP server and/or skills from AI clients.

```sh
# Remove everything from all clients
octen reset --all

# Remove only MCP entries
octen reset --mcp

# Remove only skills from a specific client
octen reset --skills --claude-code
```

Options: `--all` (both surfaces, all clients), `--mcp`, `--skills`, plus per-client flags: `--claude-code`, `--cursor`, `--claude-desktop`, `--windsurf`, `--vscode`, `--codex`, `--openclaw`, `--hermes`, `--scope` (user|project).

---

## Shell completion

`octen completion <shell>` prints a completion script for `bash`, `zsh`, or `fish`. It completes subcommand names and each subcommand's flags.

```sh
# zsh — add to ~/.zshrc
eval "$(octen completion zsh)"

# bash — add to ~/.bashrc
eval "$(octen completion bash)"

# fish — write to the completions dir
octen completion fish > ~/.config/fish/completions/octen.fish
```

---

## Output

All commands print human-readable output when stdout is a TTY. When stdout is piped or `--json` is passed, commands emit raw JSON. Use `--pretty` to force human-readable output even when piped. `--no-color` disables ANSI colors.

## Keeping things up to date

- **MCP server**: `octen-mcp` is invoked via `npx` so it auto-pulls the latest version on each run. Pin a version with `--pin` if you need stability.
- **Skills**: re-run `octen configure-skills --all` to fetch the latest skills from upstream.
- **CLI itself**: `npm i -g @octen.ai/cli@latest`

## About

`@octen.ai/cli` wraps the Octen API (web search, content extraction, chat completions, text and multimodal embeddings) and handles one-command setup of the [Octen MCP server](https://www.npmjs.com/package/octen-mcp) and Agent Skills across Claude Code (CLI and Desktop app), Cursor, Claude Desktop, Windsurf, VS Code, Codex, OpenClaw, and Hermes.
