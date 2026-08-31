# Changelog

All notable changes to the Octen CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
