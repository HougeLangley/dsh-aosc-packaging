# dsh-aosc-packaging

[![CI](https://github.com/HougeLangley/dsh-aosc-packaging/actions/workflows/ci.yml/badge.svg)](https://github.com/HougeLangley/dsh-aosc-packaging/actions/workflows/ci.yml)

AOSC OS packaging toolkit for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): six Host tools that inspect, lint, scaffold and plan ABBS / Autobuild4 packages, plus a bundled `aosc-packaging` skill that carries the topic-to-release workflow.

AOSC OS builds `.deb` packages from the [ABBS tree](https://github.com/AOSC-Dev/aosc-os-abbs) with Autobuild4, Ciel and BuildKit. That procedure is spread across several manuals. This bundle puts the same map into one skill and backs it with deterministic tools, so an agent can read a package, say what the style rules would reject, write a scaffold, checksum a source, and draft the branch, commit, PR body and BuildIt! commands instead of guessing.

Nothing here runs a shell. Five tools never write to disk; `aosc_checksum_source` is the only one that uses the network, and `aosc_scaffold_package` is the only one that writes files — two of them, inside a tree you name. Building the actual package still needs Linux, root and Ciel.

## Requirements

| Requirement | Detail |
| --- | --- |
| Node.js | 22 or newer. ESM only, no build step, no runtime dependencies. |
| Host | DSH `0.2.1-rc.5` or newer in the `0.2.x` line; the bundle loads through the `dsh.bundle` manifest. |
| Client OS | All six tools run on macOS, Windows and Linux. |
| Real builds | Linux + root + Ciel + at least 10 GiB of free disk. |

`aosc_build_plan` only prints the commands; it never runs Ciel, Git or BuildIt!. On macOS and Windows the toolkit still covers inspect, lint, scaffold, checksum and plan, but the build itself needs a Linux host with Ciel installed, as the AOSC OS manuals require.

## Install

### From GitHub

```sh
dsh plugin --profile desktop add github:HougeLangley/dsh-aosc-packaging
```

Replace `desktop` with another profile name if that is the profile you want the bundle in.

### From a local checkout

```sh
git clone https://github.com/HougeLangley/dsh-aosc-packaging.git
cd dsh-aosc-packaging
dsh plugin --profile desktop add "$PWD"
```

### From the Plugins page

Open **Plugins** in the dsh desktop app, start adding a plugin, and point it at the checkout directory instead of a package name. A local directory is read from disk rather than from a package registry.

The bundle's `dsh.bundle` manifest points at `cordis.patch.yml`, which inserts one entry, `dsh-aosc-packaging`. On activation the plugin registers the six tools and, when the Host exposes a skill service, the `aosc-packaging` skill. If the skill file cannot be read the tools keep working; activation never fails over it.

## Tools

| Tool | What it does | Network | Writes files |
| --- | --- | --- | --- |
| `aosc_inspect_package` | Parses `spec` and `autobuild/defines`, reports which optional `autobuild/` files exist, and embeds the lint result | No | No |
| `aosc_lint_package` | Runs the static package and commit-message rules over a package directory | No | No |
| `aosc_scaffold_package` | Validates inputs, then writes `spec` and `autobuild/defines` into `<treeRoot>/<pkgname>` and lints the result | No | Yes — only that package directory |
| `aosc_checksum_source` | Streams each source URL through SHA-256, SHA-512 or SHA-1 and returns a `CHKSUMS=`-ready string | Yes — the URLs you pass | No, never touches disk |
| `aosc_topic_plan` | Drafts the branch name, commit subject and body, PR title and body, BuildIt! commands and checklist for a topic | No | No |
| `aosc_build_plan` | Returns the ordered `ciel` / `git` / `oma` / `p-vector` command plan with prerequisites and notes | No | No |

### `aosc_inspect_package`

Input: `{ path }`. The result contains the resolved absolute path, a `layout` object (`spec`, `defines`, `prepare`, `patch`, `build`, `beyond`, `pax`, patch count, override count), the parsed `spec` and `defines` structures, and the same issue list the linter returns. Missing optional files produce empty structures; only a non-existent package path throws.

### `aosc_lint_package`

Input: `{ path, commitMessage?, strict? }`. The checker covers package identity and layout (`E101`–`E104`), `spec` sources and checksums (`L001`–`L007`), description style (`L008`, `L009`), `ABTYPE` and build files (`L010`–`L013`, `L017`, `L018`), patch naming (`L014`), shell quoting in `autobuild/*` scripts (`L015`), `/usr/local` overrides (`L016`), an empty `PKGDEP` information note (`L019`), and the topic commit format (`W121`, `W122`). `ok` is true when there are no errors, and in `strict` mode only when there are no warnings either. It is offline: the canonical `PKGSEC` list is an embedded snapshot.

### `aosc_scaffold_package`

Input: `{ treeRoot, pkgname, ver, section, description, sources, abtype, depends, buildDepends, recommends, noarch, rel, epoch, overwrite }`. Inputs are validated before anything is written; an existing package directory is refused unless `overwrite` is `true`. The response returns the full text of both generated files and the lint result, including the warning that `CHKSUMS="SKIP"` is a placeholder waiting for real digests. `$VER` inside a source URL is preserved literally in `spec`.

### `aosc_checksum_source`

Input: `{ urls, algorithm?, timeoutMs? }`. Defaults are `sha256` and 20,000 ms. Redirects are followed, each response is hashed as a stream, non-2xx responses are rejected, and a source above 256 MiB stops with a clear error. The file is never written to disk; the redirect target is reported alongside the checksum.

### `aosc_topic_plan`

Input: `{ packages, kind, version, purpose, summary, canonicalPkg, date, labels, arch }`. `kind` is one of `new`, `update`, `security`, `change`, `rebuild` or `drop`, and `packages` is in build order. The result contains `branch`, `commitMessage`, `commitBody`, `prTitle`, `prBody`, `builditCommands` (`openpr`, `pr`, `build`), `warnings` and `checklist`. Branch and commit naming follow the AOSC topic and styling manuals, and multi-package topics warn when `canonicalPkg` is missing.

### `aosc_build_plan`

Input: `{ packages, instance?, arch?, topic?, workspace? }`. Phases run from environment preparation and tree checkout through the topic branch, `ciel build`, `.deb` inspection, install and test, commit and PR through BuildIt!, the mandatory post-merge stable rebuild, and the p-vector repository release. Every command is copy-paste ready and carries its purpose; notes repeat the Linux/root/10 GiB requirement, one clean BuildKit per package, and the stable rebuild.

## Skill: `aosc-packaging`

The bundle registers one skill, `aosc-packaging`. Use it when a task involves any of: the AOSC OS release model and ABBS tree, a `spec` or `autobuild/defines` file, Autobuild4 `ABTYPE` selection, `ciel` / BuildKit / `oma`, topic branch and PR conventions, BuildIt! bot commands, p-vector releases, or a `.deb` that has to be reviewed before it is pushed.

The skill covers what AOSC OS is and how its rolling release and topics work; the toolchain map (ABBS, ACBS, Autobuild4, Ciel/BuildKit, oma, BuildIt!, p-vector, aoscbootstrap); environment setup; package anatomy; `spec` variables and version normalisation; `defines` variables and the direct-ELF dependency rule; choosing `ABTYPE`; packaging policy and file placement; the build loop; the topic workflow; the commit-message table; BuildIt! commands; p-vector release and QA issue-code classes; image and ISO releases; a map from each packaging step to the matching tool; and troubleshooting for FTBFS, dependency and checksum failures.

It links its own references (`spec-reference.md`, `defines-reference.md`, `workflow-commands.md`, `qa-codes.md`) and every non-obvious claim carries a source URL in `docs/SOURCES.md`.

## Example prompts

1. `Inspect ~/abbs/nano and tell me which lint errors would block the topic before I commit anything.`
2. `Scaffold a new package hello at 2.12.1 in ~/abbs from https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz, then checksum that URL and give me the CHKSUMS line to paste in.`
3. `Plan the nano 7.2 build-fix topic: branch name, commit message, PR body, and the /openpr command for BuildIt!.`

Each one maps to tools described above: the first to `aosc_inspect_package` and `aosc_lint_package`, the second to `aosc_scaffold_package` plus `aosc_checksum_source`, the third to `aosc_topic_plan`. Add `aosc_build_plan` when you want the Ciel command sequence as well.

## Safety and side effects

- **No shell execution.** No tool spawns `ciel`, `git`, `oma`, `p-vector` or a shell. Commands are returned as strings; running them is your decision.
- **One network path.** `aosc_checksum_source` sends HTTP(S) GET requests to exactly the URLs you pass, follows redirects, honours the timeout (default 20 s) and the call's abort signal, and caps each source at 256 MiB. Checksums are computed on the stream, so nothing is saved.
- **One write path.** `aosc_scaffold_package` creates `spec` and `autobuild/defines` under `<treeRoot>/<pkgname>`, and nothing outside it. It refuses an existing directory unless `overwrite: true`.
- **Read-only by default.** Inspect, lint, topic planning and build planning neither write nor fetch. Linting uses an embedded `PKGSEC` snapshot, not a live download.

## Scope and limits

- There is no UI, no settings page and no client panel; the bundle is Host tools plus a skill.
- It does not build packages, run Ciel, open pull requests or publish to ABBS. Those steps stay manual or belong to BuildIt!.
- It is not a package manager and installs no AOSC OS software.
- The plan output reflects the AOSC OS manuals; where a manual changes, the skill's `docs/SOURCES.md` is the trail to re-check.

## Repository layout

```
dsh-aosc-packaging/
├── package.json                     # bundle manifest, exports, scripts
├── cordis.patch.yml                 # loader entry
├── lib/
│   ├── index.js                     # plugin entry: six tools + skill registration
│   ├── parse.js                     # spec / defines parsing
│   ├── lint.js                      # static rules
│   ├── scaffold.js                  # spec + defines generation
│   ├── checksum.js                  # streaming source hashing
│   ├── topic.js                     # topic / PR / BuildIt! planning
│   └── buildplan.js                 # Ciel build plan
├── skills/aosc-packaging/
│   ├── SKILL.md                     # the packaging methodology
│   └── references/                  # spec, defines, commands, QA codes
├── docs/
│   ├── SOURCES.md                   # source URL for every claim
│   ├── DETAIL.md                    # one feature image
│   ├── preview.svg                  # 640×300 pipeline illustration
│   └── MARKETPLACE.md               # catalog entry and PR steps
├── locale/
│   ├── en.json
│   └── zh.json
├── icon.svg
├── README.md
├── README.zh-CN.md
├── LICENSE
├── CHANGELOG.md
└── tests/*.test.mjs
```

## Development

No install step and no dependencies: the source runs as-is on Node.js 22 and newer.

```sh
npm test                     # node --test tests/
node --check lib/index.js    # syntax-check one file
```

The plugin entry is `lib/index.js`; `package.json` exports it as both the main entry and `.`. The skill is plain Markdown read from disk at activation, so editing it needs no rebuild.

## Marketplace

The bundle is meant to be listed in the dsh plugin market. The exact catalog line, the submission file for `awesome-dsh-plugin/awesome-dsh-plugin`, the PR steps and the Discover index notes are in [docs/MARKETPLACE.md](docs/MARKETPLACE.md). Status at 0.1.0: not yet listed.

## License

MIT © 2026 HougeLangley. See [LICENSE](LICENSE).
