# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-13

### Added

- `dsh-aosc-packaging` bundle manifest and `cordis.patch.yml` loader entry.
- `aosc_inspect_package` Host tool: parses `spec` and `autobuild/defines`, reports the `autobuild/` layout and embeds the lint result.
- `aosc_lint_package` Host tool: static package and commit-message rules (`E101`–`E104`, `L001`–`L019`, `W121`, `W122`), with optional `strict` mode.
- `aosc_scaffold_package` Host tool: validates inputs, writes `spec` and `autobuild/defines` under `<treeRoot>/<pkgname>`, and lints the result.
- `aosc_checksum_source` Host tool: streams source URLs through SHA-256, SHA-512 or SHA-1, follows redirects, caps at 256 MiB and never writes to disk.
- `aosc_topic_plan` Host tool: branch, commit message, PR title and body, BuildIt! commands and checklist for AOSC OS topics.
- `aosc_build_plan` Host tool: ordered `ciel` / `git` / `oma` / `p-vector` command plan with prerequisites, notes and checklist.
- `aosc-packaging` runtime skill with references for `spec`, `defines`, workflow commands and QA issue codes, sourced in `docs/SOURCES.md`.
- English and Simplified Chinese locale metadata (`locale/en.json`, `locale/zh.json`) with a single-image detail document (`docs/DETAIL.md`, `docs/preview.svg`).
- Plugin icon (`icon.svg`), README in English and Simplified Chinese, marketplace submission material (`docs/MARKETPLACE.md`), MIT license and this changelog.

[0.1.0]: https://github.com/HougeLangley/dsh-aosc-packaging/releases/tag/v0.1.0
