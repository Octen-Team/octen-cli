# Changelog

All notable changes to the Octen CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] — 2026-07-06

Aligns the `extract` command with the current Extract API reference
(https://docs.octen.ai/api-reference/extract).

### Removed
- **`--favicon`** flag. The page favicon is now returned by default when
  available, so the flag is no longer needed (or accepted by the API).

### Added
- `cover_image` is surfaced in extract results (pretty + JSON) when `--images`
  is set and the page has a cover image.
