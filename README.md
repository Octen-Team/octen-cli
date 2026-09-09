# @octen.ai/cli

Command-line tool for Octen — web search, extract, chat, embeddings, and one-command MCP/Skills setup for Claude Code, Cursor, and more.

## Install

**With Node.js (npm):**

```sh
npm i -g @octen.ai/cli
```

Or run without installing: `npx @octen.ai/cli <command>`. Requires Node.js 18+.
Uninstall: `npm uninstall -g @octen.ai/cli`.

### Without Node.js — Homebrew (macOS/Linux)

Install (one command — it taps automatically):

```sh
brew install Octen-Team/tap/octen
```

Uninstall:

```sh
brew uninstall octen
brew untap Octen-Team/tap   # optional — also removes the tap
```

### Without Node.js — raw binary

Download the binary for your platform from the
[latest release](https://github.com/Octen-Team/octen-cli/releases/latest)
(`octen-darwin-arm64`, `octen-darwin-x64`, `octen-linux-x64`, `octen-linux-arm64`),
`chmod +x` it, and put it on your `PATH`.

Then enable tab-completion (one-time; `bash` / `zsh` / `fish`):

```sh
octen completion zsh --install     # writes to ~/.zshrc — then: source ~/.zshrc
```

## Auth

Octen CLI resolves the API key to use in this order — each step stopping resolution before
the next, so an explicit value always wins over a stored one:

1. `--api-key <key>` on the command itself
2. `OCTEN_API_KEY` in the environment
3. `~/.octen/credentials.json`, written by `octen login`

Get a key at https://octen.ai. Either export it directly:

```sh
export OCTEN_API_KEY=your_key_here
```

or log in once and let the CLI manage it:

```sh
octen login
```

`octen login` opens your browser, completes an OAuth consent flow, and stores the resulting
API key at `~/.octen/credentials.json` (written with `0600` permissions). That key does not
expire, so `octen configure-mcp` and `octen configure-skills --set-key` can write it into
AI-client configs once and forget about it.

You can also pass `--api-key <key>` or `--base-url <url>` on any command; to point at a
self-hosted or staging endpoint, set `OCTEN_API_URL` or pass `--base-url <url>`.

Run `octen whoami` to see which of the three sources is actually in effect — it names the
winner explicitly, so a stored credential that is being shadowed or ignored says so rather
than looking live.

### Auth environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `OCTEN_API_KEY` | — | The API key to use. Takes precedence over `~/.octen/credentials.json`, so a stored login is ignored while it is set. |
| `OCTEN_API_URL` | `https://api.octen.ai` | The Octen API base URL. |
| `OCTEN_AUTH_ISSUER` | `https://auth.octen.ai` | The OAuth authorization server `octen login` talks to. Only for local development against a self-hosted AS. |
| `OCTEN_AUTH_RESOURCE` | `https://cli.octen.ai` | The audience `octen login` requests the access token for. Only for local development. |

`OCTEN_AUTH_ISSUER` and `OCTEN_AUTH_RESOURCE` **must not have a trailing slash** — a
trailing one is rejected with a named error rather than silently trimmed, because trimming
is what once turned a JWKS URL into `//api/oauth/jwks` and made a byte-for-byte issuer
comparison fail.

Changing either of them makes an existing stored credential **inapplicable**: the credential
records the issuer and resource it was minted for, and one minted for a different pair
belongs to another environment. The CLI never uses it and never deletes it — it says so and
names the variable. Unset the variable to go back to the stored credential, or run `octen
login` again to get one for the new environment. `octen whoami` shows both the stored
`Issuer`/`Resource` and which credential is in effect.

**Add `.octen/` to your global gitignore.** A credentials file living in a dotfile directory
is more likely to be committed by accident than an environment variable ever was:

```sh
git config --global core.excludesfile ~/.gitignore_global
echo ".octen/" >> ~/.gitignore_global
```

**No browser on this machine (CI, containers)?** Paste a key directly — this branch makes
zero network requests:

```sh
octen login --api-key "$OCTEN_API_KEY"
```

**Over SSH**, forward the loopback callback port and pin it on both ends:

```sh
# on the remote machine
octen login --port 8765
# from your local machine, before approving the consent screen in your browser
ssh -L 8765:localhost:8765 remote-host
```

### `octen logout`'s exact semantics

`octen logout` deletes `~/.octen/credentials.json` and revokes *this device's authorization*
(the OAuth grant behind it). Revoking the authorization only prevents it from being used to
silently mint a new credential later — it does **not** deactivate the underlying API key.
That key is your own account-wide, long-lived key, and the same key is very likely also
sitting on other machines, in your production code, and in the AI-client configs `octen
configure-mcp` wrote. All of those keep working after `octen logout` — that's by design,
since they're your own legitimate uses of your own key. If you believe the key itself was
exposed, deactivate or rotate it from the key management page at https://octen.ai — that
action, unlike `logout`, affects every place holding the key.

`octen logout --local` skips the network call entirely and only removes the local file,
without attempting to revoke the authorization.

### Dashboard "revoke" and an already-logged-in CLI (F12)

The dashboard's per-authorization "revoke" button has **no effect on a device that already
holds a credential**: it only stops that device from obtaining a *new* one without going
through the consent screen again — the API key it already has keeps working exactly as
before. The authorization still shows up in the dashboard's list either way; run `octen
whoami` on the device in question to get its `grantId` so you can identify which entry in
that list corresponds to it. To actually stop a key from working anywhere, deactivate or
rotate it from the key management page, not the authorization list.

### Switching from a browser login to a pasted key

`octen login --api-key <KEY>` overwrites any existing `source: login` credential on disk
without revoking its grant — that branch makes no network request at all, by design (see
above). So if you switch a machine from a browser login to a pasted key, the old
authorization is left behind: it stays listed as active in the dashboard's authorization
list, and once its `grantId` is gone from this machine's disk, nothing here can revoke it —
only the dashboard can. Revoke it there directly if you want to clean it up.

## Commands

### `octen login`

Log in via your browser and store the resulting long-lived API key at
`~/.octen/credentials.json`.

```sh
octen login

# print the authorize URL instead of opening a browser
octen login --no-browser

# pin the loopback callback port, e.g. for the ssh -L forwarding above
octen login --port 8765

# no browser available: store a key directly, with zero network requests
octen login --api-key "$OCTEN_API_KEY"
```

If a `source: login` credential already exists, `octen login` best-effort revokes its grant
before starting the new login, so repeated logins don't accumulate orphaned authorizations
in the dashboard. A failure to revoke never blocks the new login.

Options: `--port <n>`, `--no-browser`.

---

### `octen logout`

Revoke this device's authorization and remove the locally stored credential. See
[Auth](#auth) above for the exact semantics — this does **not** deactivate the API key
itself.

```sh
octen logout

# skip the network call; only remove the local file
octen logout --local
```

A credential created with `octen login --api-key` has no authorization to revoke, so this
just removes the file, with zero network requests, and the output never mentions revocation
for that case.

Options: `--local`.

---

### `octen whoami`

Show the locally stored credential: account, credential source, and the `grantId` you can
use to find and revoke this device in the dashboard's authorization list. This reads only
`~/.octen/credentials.json` — it makes **zero network requests** and does not verify that
the key still works (run `octen search` for that; there's deliberately no `--verify` flag).

```sh
octen whoami
octen whoami --json
```

Exits non-zero when not logged in.

---

### `octen search`

Search the live web.

```sh
octen search "latest LLM benchmarks" -n 10 --topic news --highlight --time-range week
```

Options: `-n` (result count 1–100), `--topic` (general|news), `--highlight` (+`--highlight-max-tokens`, 100–20000), `--time-range` (day|week|month|year or d|w|m|y), `--start-time`/`--end-time` (YYYY-MM-DD or ISO datetime), `--include-domains`, `--exclude-domains`, `--language` (comma-separated ISO 639-1 codes, e.g. `en,ja` — one of `ar de en es fr hi id it ja ko nl pl pt ru th tr vi zh`), `--full-content` (+`--full-content-max-tokens`, 100–100000), `--images`, `--format` (text|markdown), `--safesearch`.

---

### `octen news`

News-focused web search (same flags as `search` minus `--topic`).

```sh
octen news "OpenAI announcement" --highlight --time-range day
```

---

### `octen broad-search`

Broad multi-angle web search (alias: `octen broad`). Decomposes the query into sub-queries searched concurrently, returning results grouped by sub-query for comprehensive coverage.

Use it for comparisons across many sources (pricing, products, vendors), surveys/research, and multi-angle questions — cases where a single `octen search` only reaches a few subtopics. Pass the query as-is (sub-queries are generated for you); raise `--max-queries` for broader coverage, or use `octen search` for a single focused query.

```sh
octen broad-search "compare cloud GPU pricing across providers" --max-queries 5 -n 10
```

Options: `--max-queries` (decompose into up to N sub-queries, 1–30, default 5), plus all `octen search` flags (`-n/--count` per sub-query, `--topic`, `--highlight`, `--full-content`, `--time-range`, `--start-time`/`--end-time`, `--include-domains`/`--exclude-domains`, `--include-text`/`--exclude-text`, `--language`, `--images`, `--format`, `--safesearch`).

---

### `octen extract`

Extract content from one or more URLs (1–20).

```sh
octen extract https://example.com --query "pricing" --max-age 3600 --images
```

Options: `--query` (relevance hint), `--max-age <sec>` (cache age, 300–31536000), `--images` (also returns `cover_image` when present), `--videos`, `--audio`, `--format` (markdown|text), `--fetch-timeout <sec>` (1–60), `--full` (print full page content). The page favicon is returned by default when available.

Pretty output truncates page content to ~500 chars for readability; pass `--full` to print the whole thing (or `--json` for the raw response).

---

### `octen chat`

Chat completion with optional streaming.

```sh
octen chat "Summarize the Octen docs" -m anthropic/claude-haiku-4.5
```

Streaming is on by default when output is a TTY; use `--no-stream` to get a single JSON response. Pass `-i` for interactive REPL mode. Set `OCTEN_CHAT_MODEL` to avoid specifying `-m` every time.

**Web search** is powered by built-in server tools. Pass `--search` to let the model search the web via the `octen_search` tool (the old `--web-search on` flag has been removed), and/or `--broad-search` to enable the `octen_broad_search` tool, which fans a question out into several sub-queries for comprehensive coverage — both may be enabled together:

```sh
octen chat "What launched at the latest Octen event?" -m anthropic/claude-haiku-4.5 --search --search-count 10
octen chat "Compare cloud GPU pricing across providers" -m anthropic/claude-haiku-4.5 --broad-search --search-max-queries 5
```

When search runs, cited sources are listed after the answer (pretty mode) and the raw response includes `search_results` and per-message `annotations`.

Core options: `-m/--model`, `--system`, `--cache-system` (mark the system message as a cache_control ephemeral block), `--no-stream`, `-i/--interactive`.

Sampling: `--temperature`, `--top-p`, `--top-k`, `--min-p`, `--top-a`, `--repetition-penalty`, `--frequency-penalty`, `--presence-penalty`, `--max-tokens`, `--stop`, `--seed`, `--verbosity` (low|medium|high).

Reasoning: `--reasoning-effort` (xhigh|high|medium|low|minimal|none), `--reasoning-max-tokens`. When a model emits reasoning it is shown under a dim `reasoning:` prefix in pretty mode.

Web search (only meaningful with `--search` and/or `--broad-search`): `--search-max-searches <n>` (octen_search only; default 5), `--search-max-queries <n>` (octen_broad_search only; 1-30, default 5), `--search-topic` (general|news), `--search-count <n>` (1-100), `--search-include-domains <list>`, `--search-exclude-domains <list>`, `--search-include-text <list>`/`--search-exclude-text <list>` (max 5 each), `--search-time-basis` (auto|published|crawled), `--search-time-range` (day|week|month|year or d|w|m|y), `--search-start-time <when>`, `--search-end-time <when>`, `--search-format` (markdown|text), `--search-safesearch` (off|strict), `--search-language <list>` (comma-separated ISO 639-1 codes, e.g. `en,ja` — one of `ar de en es fr hi id it ja ko nl pl pt ru th tr vi zh`), `--search-include-images`, `--search-full-content` (+`--search-full-content-max-tokens <n>`), `--search-highlight-max-tokens <n>`. The shared options apply to whichever tool(s) are enabled.

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

### `octen image-search`

**In Beta** — contact us to request beta access.

Search the web for images, either by text query or by example image.

```sh
octen image-search "red sports car" -n 10 --topic design
octen image-search --image https://example.com/car.jpg
octen image-search --image ./car.png
```

The endpoint takes exactly one input, so pass a query **or** `--image`, not both. `--image` accepts a public URL or a local file path (read inline as base64, max 5MB).

Options: `--image <url|path>`, `--topic` (general|design), `-n` (result count 1–10), `--include-domains`, `--exclude-domains`, `--safesearch` (off|strict), `--html-snippet` (+`--html-snippet-max-tokens`, 100–100000).

Unlike `octen search` and `octen video-search`, this endpoint has no time filters.

---

### `octen video-search`

**In Beta** — contact us to request beta access.

Search the web for videos by text query.

```sh
octen video-search "how to make espresso" -n 10 --time-range month
```

Options: `-n` (result count 1–10), `--time-range` (day|week|month|year or d|w|m|y), `--start-time`/`--end-time` (YYYY-MM-DD or ISO datetime), `--safesearch` (off|strict).

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

Only clients detected as installed are configured; `--all` skips the rest, and an explicitly-named client that isn't detected is skipped unless you pass `--force`.

Options: `--all`, `--claude-code`, `--cursor`, `--claude-desktop`, `--windsurf`, `--vscode`, `--codex`, `--scope` (user|project), `--pin <version>`, `--force` (configure even if the client is not detected).

Run without flags to print current status for each client.

#### Config scopes

`--scope` selects which file is written, and an unknown scope is an error rather
than a silent fall back to `user`:

| Client | `--scope user` | `--scope project` |
|---|---|---|
| Codex | `$HOME/.codex/config.toml` | `<project>/.codex/config.toml` |
| Cursor | `$HOME/.cursor/mcp.json` | `<project>/.cursor/mcp.json` |
| VS Code | `<project>/.vscode/mcp.json` | `<project>/.vscode/mcp.json` |
| Claude Code, Claude Desktop, Windsurf | user config only | same as user |

Codex reads a project-level `.codex/config.toml` only in a repository it has
been told to trust, so a project-scoped entry stays inert until you trust the
directory in Codex. `--scope status` and `reset --scope project` read and remove
from the same project file.

#### Codex cold start

On a machine that has never run `octen-mcp`, `npx -y octen-mcp` has to fetch
the package and its dependency tree before the server can answer `initialize`.
Measured on macOS 15 / Node 24.18 / octen-mcp 0.5.1, from an empty npm cache
(`npm_config_cache` pointed at a fresh directory) over three trials: **9.45s,
9.59s and 9.75s** to `initialize`, 53 MB and ~4,200 files downloaded, all six
tools listed. The same run against a warm cache: **0.24s**.

Codex's default MCP startup window is in the same ballpark as that cold
figure, so a fresh-cache first run is a race — which is how the Octen tools
can be missing from a session that reports no error. Two optional keys make
Codex wait for the server instead:

```toml
[mcp_servers.octen]
command = "npx"
args = ["-y", "octen-mcp"]
required = true
startup_timeout_sec = 60

[mcp_servers.octen.env]
OCTEN_API_KEY = "${OCTEN_API_KEY}"
```

`required` and `startup_timeout_sec` are fields of Codex's MCP server config
(verified against codex-cli 0.153.4); Codex silently ignores config keys it does
not know, so check your own version before relying on them. Warming the cache
once with `npm i -g octen-mcp` (or a single `npx -y octen-mcp` run) is the
other way to close the same gap. `required = true`
means a server that fails to start blocks the Codex session, which is why
`octen configure-mcp --codex` does not write these two keys by default — add
them yourself where Octen has to be available. The `env` table is the same shape
`configure-mcp` writes. `${OCTEN_API_KEY}` above is a documentation placeholder,
not a value Codex expands: inject the real key through `configure-mcp` or your
own secret handling, and never commit one.

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

# Also write OCTEN_API_KEY into the client's env config
octen configure-skills --claude-code --set-key --api-key <key>
```

Supported clients: Claude Code, Cursor, Codex, OpenClaw, Hermes.

Claude Desktop reads the same `~/.claude/skills` as Claude Code, so `--claude-code` already installs skills the desktop app will use. `--claude-desktop` is accepted as an explicit alias for that shared target.

`--set-key` also writes OCTEN_API_KEY into the client's env config (Claude Code `~/.claude/settings.json`, Codex `config.toml`, OpenClaw `.env`); Cursor/Hermes print a shell-profile hint. The key comes from `--api-key` or the `OCTEN_API_KEY` environment variable.

Only clients detected as installed are configured; `--all` skips the rest, and an explicitly-named client that isn't detected is skipped unless you pass `--force`.

Options: `--all`, `--claude-code`, `--cursor`, `--codex`, `--openclaw`, `--hermes`, `--scope` (user|project), `--ref <ref>` (default: main), `--bundled`/`--offline` (use vendored skills), `--only <names>` (comma-separated skill names), `--skills-dir <path>` (custom source directory), `--set-key` (write OCTEN_API_KEY into the client's env config), `--force` (configure even if the client is not detected).

Run without flags to show installed skills per client.

---

### `octen reset`

Remove the Octen MCP server and/or skills from AI clients, or clear the stored login
credential.

```sh
# Remove everything from all clients
octen reset --all

# Remove only MCP entries
octen reset --mcp

# Remove only skills from a specific client
octen reset --skills --claude-code

# Clear ~/.octen/credentials.json (equivalent to octen logout --local)
octen reset --credentials
```

Options: `--all` (both surfaces, all clients), `--mcp`, `--skills`, plus per-client flags: `--claude-code`, `--cursor`, `--claude-desktop`, `--windsurf`, `--vscode`, `--codex`, `--openclaw`, `--hermes`, `--scope` (user|project).

`--credentials` is **not** included in `--all` — `--all`'s existing meaning is "both
surfaces (MCP + skills) across all clients", and folding in the login credential would mean
`--all` silently logs you out, which would be an unwelcome surprise. Reach for `octen
logout` instead of `reset --credentials` when there's a remote authorization to revoke too;
`reset --credentials` only ever touches the local file, with no network request.

---

## Shell completion

`octen completion <shell>` (bash | zsh | fish) sets up tab-completion for subcommands and flags.

**Easiest — `--install`** writes it into your shell config for you (idempotent):

```sh
octen completion zsh --install     # appends to ~/.zshrc
octen completion bash --install    # appends to ~/.bashrc
octen completion fish --install    # writes ~/.config/fish/completions/octen.fish
```

Then `source ~/.zshrc` (or open a new terminal) to activate it in the current session.

**Manual** — print the script and source it yourself (a subprocess can't change your running shell, so this is how to activate it immediately in the current shell):

```sh
eval "$(octen completion zsh)"     # add this line to ~/.zshrc to persist
```

---

## Output

All commands print human-readable output when stdout is a TTY. When stdout is piped or `--json` is passed, commands emit raw JSON. Use `--pretty` to force human-readable output even when piped. `--no-color` disables ANSI colors.

## Errors and exit codes

Scripts must check the exit status, not just the output.

| Status | When |
|---|---|
| `0` | The command completed and the response was complete. |
| `2` | Bad input, caught before any request: a malformed number (`--count 1.5`, `--count 2junk`), an empty comma list (`--include-domains ""`), a blank query, an unknown `--scope`, or a missing API key. |
| `1` | Everything else: HTTP errors, an API envelope with a non-zero `code`, a timeout, and stream failures. |

Two consequences worth knowing:

- **Malformed numbers and empty lists fail instead of being guessed.** `--count 1.5`
  used to be sent as `1` and `--include-domains ""` as `[""]`. Both now name the
  flag and exit 2, so no request is made.
- **A streaming answer can fail after printing part of itself.** If the stream
  carries an error event, ends without its terminator, or stalls past the
  timeout, `octen chat` exits non-zero with the partial answer already on stdout.
  It is not rolled back — a caller that ignores the exit status will treat a
  truncated answer as a complete one.

## Keeping things up to date

- **MCP server**: `octen-mcp` is invoked via `npx` so it auto-pulls the latest version on each run. Pin a version with `--pin` if you need stability.
- **Skills**: re-run `octen configure-skills --all` to fetch the latest skills from upstream.
- **CLI itself**: `npm i -g @octen.ai/cli@latest`

## About

`@octen.ai/cli` wraps the Octen API (web search, content extraction, chat completions, text and multimodal embeddings) and handles one-command setup of the [Octen MCP server](https://www.npmjs.com/package/octen-mcp) and Agent Skills across Claude Code (CLI and Desktop app), Cursor, Claude Desktop, Windsurf, VS Code, Codex, OpenClaw, and Hermes.
