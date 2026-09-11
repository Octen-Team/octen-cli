# Changelog

All notable changes to the Octen CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] — 2026-09-11

> **发布前提已满足（2026-09-10）。** 本次发布曾有一条硬性顺序约束：`octen login` 以预注册
> 公共客户端 `octen-cli` 身份授权，而那一行客户端记录由服务端在首次被用到时自动创建 ——
> 所以服务端代码必须先在生产运行，否则每一次 `octen login` 都会在 authorize 阶段以
> `invalid_client` 失败，客户端无任何回退。
>
> 约束已按顺序满足：服务端发布生产 → 对生产跑通一次真实 `octen login`（含首次按需建行）
> → 才有此次发布。

### Added

- **`octen login`.** Logs in via a one-time browser-based OAuth flow (loopback callback,
  PKCE) and stores the resulting long-lived API key at `~/.octen/credentials.json`
  (`0600`). `--api-key <key>` stores a pasted key directly with zero network requests;
  `--port <n>` pins the loopback port for `ssh -L` forwarding; `--no-browser` prints the
  authorize URL instead of opening one. The confirmation line names the account the way
  the consent screen did — `Logged in as Octen family.` — falling back to the raw account
  id when the server does not supply a name, which is also what happens against any server
  older than that field.
- **`octen logout`.** Revokes this device's authorization and removes the local
  credential. `--local` skips the network call and only removes the file. Revoking the
  authorization does not deactivate the underlying API key — see the README's Auth
  section for the exact semantics.
- **`octen whoami`.** Shows the locally stored credential — account, credential source,
  and the `grantId` used to find and revoke this device in the dashboard's authorization
  list. Reads only the local credentials file; makes no network requests. Supports
  `--json`. Exits non-zero when not logged in.
- **`octen reset --credentials`.** Clears the locally stored login credential.
  Deliberately not folded into `--all`, whose existing meaning is "both surfaces (MCP +
  skills) across all clients." Like `octen logout --local`, it prints the `grantId` of a
  `source: login` credential before destroying it — otherwise the authorization stays
  listed in the dashboard with nothing left on the machine able to name it. `octen login
  --api-key` prints the same warning when it overwrites a browser login.
- **`OCTEN_AUTH_ISSUER` and `OCTEN_AUTH_RESOURCE`** are now documented (README Auth
  section and `octen login --help`). They override the OAuth authorization server and
  the token audience for local development against a self-hosted AS; both default to
  production, must have no trailing slash, and changing either makes an existing stored
  credential inapplicable — the CLI now says exactly that and names the variable, instead
  of reusing the generic "No API key. Run `octen login`" message for a case where
  logging in again would not have helped.
- `octen configure-skills --set-key` now resolves the key through the same
  `--api-key` > `OCTEN_API_KEY` > `octen login` credential priority as every other
  command, instead of reading `OCTEN_API_KEY` directly — a login credential now feeds
  straight into AI-client configs.

## [0.8.0] — 2026-09-08

### Fixed

- **The stored issuer is no longer trusted with the API key.** `octen login`'s
  cleanup step and `octen logout` sent the credential's account-wide API key to
  whatever host the credentials file named, without checking it against the
  issuer this run is for — while credential *resolution* refused to use that
  same credential for exactly the reason that it belongs to another
  environment. Neither `OCTEN_AUTH_ISSUER` nor the stored issuer was checked for
  a scheme either, so `http://` put the access token and the API key on the wire
  in cleartext with no warning. Both now require https, with a `127.0.0.1`
  loopback literal as the only exception (local development); `localhost` is not
  exempt, since the hosts file can redirect it. `octen login` now leaves a
  credential from another issuer or audience alone and prints its grant id
  rather than silently mailing its key away.

- **`octen logout` no longer claims an authorization is gone when it may not
  be.** The server answers 400 to three different situations and the response
  carries nothing to tell them apart — including one where the grant is still
  active and only this key can no longer act on it, which is what happens after
  you are removed from the organization that owns the key. Those users were told
  "nothing left to revoke". The message now states both possibilities and points
  at the grant id in the dashboard.

- **A key from `~/.octen/credentials.json` no longer reaches another process's
  argv or a world-readable file.** `octen configure-mcp` passed it to
  `claude mcp add` as a command-line argument, visible in `ps` for the child's
  lifetime, and both `configure-mcp` and `configure-skills --set-key` wrote it
  into client configs with the default 0644. Config files carrying a key are now
  written 0600 (existing files are chmod'ed, since a merge does not recreate
  them), and a literal key is written directly to the config instead of being
  handed to a subprocess.

- **`octen whoami` no longer contradicts what other commands do.** With a
  corrupt credentials file and `OCTEN_API_KEY` set, every other command worked
  while `whoami` exited 2 — and in `--json` mode printed no JSON at all. Its
  exit code also tracked "does a credentials file exist" rather than "is a key
  in effect", so it exited 0 while reporting that nothing was in effect, and 2
  while an environment key was working fine. It now tolerates an unreadable file
  whenever a flag or environment key already decides the answer, and exits
  non-zero exactly when no key is in effect.

- **`configure-mcp` and `configure-skills` name the real problem.** A usable
  stored credential plus an `OCTEN_AUTH_ISSUER` override produced "no API key
  found", a `${OCTEN_API_KEY}` placeholder config and exit 0 — and, from
  `configure-skills`, advice to run `octen login`, which cannot fix an
  `OCTEN_AUTH_*` override. Only a total absence of credentials is treated as a
  missing key now; expiry and issuer/resource mismatch report themselves.

- **Numeric flags are parsed strictly.** `parseInt`/`parseFloat` accepted a
  numeric prefix and threw the rest away, so `--count 1.5` was sent as `1`,
  `--count 2junk` as `2` and `--count 1e2` as `1`. A value that is not exactly
  an integer (or, for float flags, a complete decimal) now names its flag and
  exits 2 before any request. Hex, trailing garbage, empty strings and
  non-finite values are all rejected; range checks still live in the request
  builders.

- **Empty comma lists are rejected.** `--include-domains ""` produced `[""]`,
  a filter matching nothing that the caller never asked for, and
  `configure-skills --only " , "` installed zero skills while reporting
  success. Items are trimmed, empties dropped, and a list with nothing left
  fails. Applies to every comma list on `search`, `news`, `broad-search`,
  `image-search`, `chat` and `configure-skills` (`--stop` is unchanged: an
  empty stop token is a separate question).

- **Blank queries are rejected.** `search "   "` and `broad-search "   "` were
  sent as-is. They now fail locally; a valid query is still sent verbatim,
  untrimmed.

- **`configure-mcp --codex --scope project` writes the project file.** The
  Codex registry entry ignored the scope and always wrote
  `$HOME/.codex/config.toml`, so a project-scoped request silently edited the
  global config. It now writes `<project>/.codex/config.toml`, which Codex
  reads for a trusted repository, and `configure-mcp` status and
  `reset --scope project` read the same file.

- **An unknown `--scope` is an error.** `--scope global` was coerced to `user`
  by `configure-mcp`, `configure-skills` and `reset` — writing to, or deleting
  from, a file the caller did not name.

- **Nested error objects are readable.** A non-2xx body of
  `{"error":{"message":"..."}}` reached the terminal as `[object Object]`, and
  `message`/`detail` were never consulted. Extraction is now `msg` →
  `message` → `detail` → a recursive `error` → the HTTP status, shared by the
  request and stream paths.

- **A 2xx response must actually carry a payload.** `null`, `[]`, `{}` and a
  non-object body were all returned as success. They now raise, as does an
  Octen envelope whose numeric `code` is non-zero — those exited 0 before, so
  an automated caller could not tell a failure from a result. A string or
  absent `code` is left to the endpoint's own shape, so OpenAI-compatible chat
  responses are unaffected.

- **`Retry-After` is honoured.** A 429 or 5xx asking for a specific delay
  (delta-seconds or HTTP-date) was ignored in favour of the exponential
  backoff. Invalid or negative values still fall back to the backoff, and any
  wait is capped at 30s so a server asking for an hour cannot hang a command
  for an hour.

- **SSE events are framed correctly.** The parser split on `\n\n`, which never
  matches a CRLF-framed stream, so those events surfaced only at EOF. It also
  parsed each `data:` line separately — dropping a JSON object split across
  data lines — and required a space after `data:`.

- **A truncated or malformed stream fails.** A stream that ended without
  `[DONE]`, a typed `finish` event or an OpenAI-style `finish_reason` was
  treated as a complete answer, and a malformed event was skipped silently.
  Both now exit 1. Partial output already written to stdout is kept, so
  callers must check the exit status.

- **A typed in-stream `error` event fails.** `octen chat` printed the partial
  answer and exited 0. It now reports the server's message and exits 1.

- **The stream timeout covers the body.** The deadline was cleared as soon as
  the response headers arrived, so a server that sent headers and then stopped
  left the CLI waiting forever. The timeout now applies to each chunk: a
  stalled stream raises `OctenTimeoutError`, while a long answer that keeps
  streaming is not cut off. This matches the per-read deadline the Python SDK
  gets from httpx.

- **Streams release their connection.** The SSE reader was never released or
  cancelled, so stopping early leaked it.

## [0.7.0] — 2026-08-31

Aligns parameter validation with the API reference. Every bound below was read
off a live `400`, not the docs — in several cases the two disagreed.

### Removed

- **`--videos` from `search` and `broad-search`.** `include_videos` is not in
  the search API reference. It stays on `octen extract --videos`, which
  documents it.

- **`--time-range` / `--start-time` / `--end-time` from `image-search`.** The
  endpoint has no time filters, and it does not reject the fields:
  `time_range="zzz_garbage"` comes back `200` with unfiltered results, where
  `search` and `video-search` both return `400`. Narrowing an image search to
  the past week returned everything and reported success — and the local
  enum/date validation made it look real. These flags are unchanged on
  `search`, `news`, `broad-search` and `video-search`.

### Changed

- **`image-search` takes exactly one input.** A query plus `--image` built a
  two-entry `inputs` array that the API always answered with
  `400 Inputs exceeds 1 entries`, so the combination could never succeed — it
  was in the README as an example. It now fails locally with a message that
  says why.

- **Token bounds enforced.** `--highlight-max-tokens` checked only its lower
  bound; `--full-content-max-tokens` and `--html-snippet-max-tokens` were not
  checked at all, though the API rejects out-of-range values on all three.
  Now 100–20000, 100–100000 and 100–100000 respectively.

- **`octen-search` skill: domain filter limits corrected** to 1200 entries of
  up to 60 characters for `include_domains` / `exclude_domains` (documented as
  1000 / 150 entries of 30 characters). Agents reading the skill were told to
  split lists the API would have served as-is. `include_text` /
  `exclude_text` (5 × 30) were already right.

## [0.6.0] — 2026-07-30

### Fixed
- `completion <shell> --install` now survives a later `compinit`. The previous
  zsh/bash install appended `eval "$(octen completion <shell>)"` to the rc file,
  registering a bash-style completion that a subsequent `compinit` — e.g. one
  added below it by another tool's installer — would silently drop. Tab
  completion then broke depending on install order.

### Changed
- `completion zsh --install` now writes a native `#compdef` `_octen` function to
  `~/.octen/completions/` and adds that directory to `fpath` (plus a `compinit`
  call) via an idempotent, marked block in `~/.zshrc`. fpath completions are
  re-discovered on every `compinit`, so ordering no longer matters. A legacy
  `eval` line from an earlier install is migrated automatically.
- `completion bash --install` now writes a native completion file to the
  bash-completion user dir (`~/.local/share/bash-completion/completions/octen`),
  lazy-loaded on demand regardless of rc ordering.
- Printed scripts (`octen completion zsh|bash` without `--install`) are unchanged
  and remain available as an `eval` fallback.

## [0.5.5] — 2026-07-27

### Added
- `--language` (search/news/broad-search) and `--search-language` (chat) flags for ISO 639-1 language filtering.

## [0.5.4] — 2026-07-24

### Removed
- `--country` and `--search-country` flags removed from search, news, broad-search, and chat.

## [0.5.3] — 2026-07-20

### Changed
- `country` parameter description aligned with the official wording: "Follow ISO 3166, the International Standard for country codes and codes for their subdivisions".

## [0.5.2] — 2026-07-16

### Added
- **`--country <code>`** flag on `search`, `news`, and `broad-search` for
  region-specific results. Takes an ISO 3166-1 alpha-2 country code (e.g. `US`,
  `JP`) or `auto` (the server default when the flag is omitted). Sent as a
  top-level field on `/search` and inside `search_options` on `/broad-search`.
  See https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2
- **`--broad-search`** flag on `chat`, enabling the new built-in
  `octen_broad_search` server tool (a peer of `octen_search` that fans the
  model's search out into several sub-queries), plus
  **`--search-max-queries <n>`** for its `max_queries` (1–30, default 5).
  `--search` and `--broad-search` may be combined; the shared `--search-*`
  options apply to whichever tool(s) are enabled.
- New `chat` web-search options aligning the search tools with the full
  WebSearchOptions contract: **`--search-topic`** (general|news),
  **`--search-time-range`** (day|week|month|year or d|w|m|y),
  **`--search-country`** (ISO 3166-1 alpha-2 or `auto`),
  **`--search-include-images`**, and the previously-unexposed
  **`--search-include-text`**/**`--search-exclude-text`** (max 5 each).

## [0.5.1] — 2026-07-06

Aligns the `extract` command with the current Extract API reference
(https://docs.octen.ai/api-reference/extract).

### Removed
- **`--favicon`** flag. The page favicon is now returned by default when
  available, so the flag is no longer needed (or accepted by the API).

### Added
- `cover_image` is surfaced in extract results (pretty + JSON) when `--images`
  is set and the page has a cover image.
