# dsh-aosc-packaging — Frozen Delivery Contract (v1)

This file is the single source of truth for every parallel worker. Do not edit it.
Package root: `/Users/suyeqin/dsh-aosc-packaging`

## 1. What we ship

A standard DeepSeek Harness (dsh) **bundle** named `dsh-aosc-packaging`, version `0.1.0`,
publishable to GitHub and later listable in the dsh plugin market.

It gives a dsh agent:

1. A runtime **skill** `aosc-packaging` (the researched AOSC OS packaging methodology).
2. Six **Host tools** that inspect, lint, scaffold and plan work on AOSC OS packages
   (the ABBS / Autobuild4 / Ciel / BuildIt! / p-vector workflow). No shell execution.

Zero runtime dependencies except the harness-provided `@deepseek-ai/dsh-tools`.
Node.js >= 22, ESM only, no TypeScript, no build step.

## 2. Frozen repository layout and ownership

```
/Users/suyeqin/dsh-aosc-packaging
├── package.json              # p8-core
├── cordis.patch.yml          # p8-core
├── lib/
│   ├── index.js              # p8-core: plugin entry, tool registration, skill registration
│   ├── parse.js              # p8-core: spec/defines parsing helpers
│   ├── lint.js               # p8-core
│   ├── scaffold.js           # p8-core
│   ├── checksum.js           # p8-core
│   ├── topic.js              # p8-core
│   └── buildplan.js          # p8-core
├── skills/aosc-packaging/
│   ├── SKILL.md              # p8-research
│   └── references/*.md       # p8-research
├── docs/
│   ├── SOURCES.md            # p8-research: every claim's URL
│   ├── DETAIL.md             # p8-docs: exactly one image line
│   ├── preview.svg           # p8-docs
│   └── MARKETPLACE.md        # p8-docs: ready-to-submit catalog entry + PR steps
├── locale/en.json            # p8-docs
├── locale/zh.json            # p8-docs
├── icon.svg                  # p8-docs
├── README.md                 # p8-docs
├── README.zh-CN.md           # p8-docs
├── LICENSE                   # p8-docs (MIT, holder: HougeLangley)
├── CHANGELOG.md              # p8-docs
├── tests/*.test.mjs          # p8-core
└── .gitignore                # p8-docs
```

Do not create files outside your ownership. Never run `git`, never install the plugin,
never edit `CONTRACT.md`.

## 3. package.json (exact shape; p8-core writes it)

```json
{
  "name": "dsh-aosc-packaging",
  "version": "0.1.0",
  "description": "Research-backed AOSC OS packaging toolkit for DeepSeek Harness: inspect, lint, scaffold and plan .deb packages built with ABBS, Autobuild4 and Ciel.",
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": [
    "lib",
    "skills",
    "docs",
    "locale/*.json",
    "cordis.patch.yml",
    "icon.svg",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
  "engines": { "node": ">=22" },
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "aosc", "aosc-os", "abbs", "autobuild", "packaging", "deb"],
  "license": "MIT",
  "author": "HougeLangley",
  "repository": { "type": "git", "url": "git+https://github.com/HougeLangley/dsh-aosc-packaging.git" },
  "homepage": "https://github.com/HougeLangley/dsh-aosc-packaging#readme",
  "bugs": { "url": "https://github.com/HougeLangley/dsh-aosc-packaging/issues" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.2.2-rc.2 <0.3.0-0" },
  "peerDependenciesMeta": { "@deepseek-ai/dsh-tools": { "optional": true } },
  "scripts": { "test": "node --test \"tests/**/*.test.mjs\"" }
}
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: aosc-packaging
      name: dsh-aosc-packaging
```

## 4. Host entry contract (`lib/index.js`)

```js
export const name = 'dsh-aosc-packaging'
export const inject = ['tools']
export async function apply(ctx) { /* register 6 tools + skill, all inside ctx.effect */ }
```

Tool registration uses the installed API exactly like this (proven pattern from a live plugin):

```js
import { defineTool } from '@deepseek-ai/dsh-tools'
const dispose = ctx.tools.register(defineTool({
  name: 'aosc_inspect_package',
  description: '...',
  parameters: { path: { type: 'string', required: true, description: '...' } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { /* ... */ } },
    render: (_args, value) => [{ type: 'text', text: '...' }],
  },
  execute: async (args, execution) => { /* return the object */ },
}))
```

`execute(args, execution)` receives `execution.signal` (AbortSignal) — honor it for network work.

Skill registration is optional at runtime; the service may be absent on old hosts:

```js
const skills = ctx.get('skills')
if (skills) {
  const content = await readFile(new URL('../skills/aosc-packaging/SKILL.md', import.meta.url), 'utf8')
  disposers.push(skills.register({
    name: 'aosc-packaging',
    description: '...one line...',
    whenToUse: '...one line...',
    content,
    source: 'runtime',
    resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../skills/aosc-packaging/', import.meta.url)) },
  }))
}
```

Register every disposer with `ctx.effect(() => () => { for (const d of disposers.reverse()) d() })`.
If the skill file cannot be read, log a warning and keep the tools working — never fail activation.

## 5. Tool contracts (names, inputs, outputs)

All outputs are plain JSON objects matching the declared schema. All errors are thrown
`Error` objects whose message names the offending file and rule. `path` arguments accept
absolute paths or paths relative to the session working directory; resolve with `node:path`.

### 5.1 `aosc_inspect_package`

Input: `{ path: string }` (required).

Output:
```json
{
  "path": "/abs/pkg",
  "layout": { "spec": true, "defines": true, "prepare": false, "patch": false, "build": false,
              "beyond": false, "pax": false, "patches": 0, "overrides": 0 },
  "spec": { "ver": "1.2.3", "rel": null, "epoch": null, "subdir": null, "dummysrc": false,
            "sources": [{ "type": "tbl", "options": {}, "uri": "https://...", "checksum": "sha256::...", "algorithm": "sha256" }],
            "chksums": ["sha256::..."], "vars": { "VER": "1.2.3" } },
  "defines": { "pkgname": "hello", "pkgsec": "utils", "pkgdes": "A hello world demo program",
               "pkgdep": ["glibc"], "builddep": [], "pkgrecom": [], "pkgbreak": [], "pkgconf": [],
               "pkgrep": [], "abtype": "autotools", "abhost": null, "abstrip": null,
               "vars": { "PKGNAME": "hello" } },
  "issues": [ /* same objects as aosc_lint_package */ ]
}
```
Missing files yield null/empty structures, not a throw. A non-existent `path` throws.

### 5.2 `aosc_lint_package`

Input: `{ path: string, commitMessage?: string, strict?: boolean }`.

Output: `{ "path": "...", "ok": true, "errorCount": 0, "warningCount": 1, "infoCount": 0, "issues": [...] }`

Issue object: `{ "code": "E103", "severity": "error|warning|info", "rule": "short-slug", "message": "...", "file": "spec", "line": 3, "fix": "optional one-line remediation" }`.
Order issues by file then line. `ok = errorCount === 0 && (!strict || warningCount === 0)`.

Required rules (use the official code when the rule maps to one, else `L###`):

| Code | Severity | Rule |
| --- | --- | --- |
| E101 | error | missing `spec` |
| E102 | error | missing `autobuild/defines` |
| E103 | error | `PKGNAME` violates `^[a-z0-9][a-z0-9+.-]*$` (p-vector allows the single-character package `r`) |
| E104 | warning | `PKGSEC` not in the canonical section set |
| L001 | error | `VER` missing |
| L002 | error | neither `SRCS` nor `DUMMYSRC=1` |
| L003 | error | `SRCS` entry with a `tbl`/`file` source but no matching checksum |
| L004 | error | `CHKSUMS` says `SKIP` for a non-VCS source |
| L005 | error | platform-generated archive URL (`github.com`/`gitlab.com` … `/archive/` or `/releases/download/…tar.gz` generated by the forge) |
| L006 | warning | plain `http://` or `ftp://` source |
| L007 | warning | literal version-looking token in a source URL instead of `$VER` |
| L008 | error | `PKGDES` starts with a lowercase letter |
| L009 | warning | `PKGDES` ends with `.`, `!`, `?`, `;` or `,` |
| L010 | error | `ABTYPE` missing (styling manual requires it explicitly) |
| L011 | error | `ABTYPE` not in the known set |
| L012 | error | `ABTYPE=self` but no `autobuild/build` |
| L013 | warning | `BUILDDEP` lists a package already in BuildKit (gcc, glibc, make, cmake, autoconf, automake, libtool, pkgconf, python-3, perl, …) |
| L014 | warning | patch filename does not match `^[0-9]{4}-` |
| L015 | warning | shell variable used unquoted in an `autobuild/*` script |
| L016 | error | file under `autobuild/overrides/` targets `/usr/local` |
| L017 | warning | `autobuild/build` exists but `ABTYPE` is not `self` |
| L018 | warning | `ABHOST` is `noarch` but `ABSPLITDBG` not disabled |
| W121 | warning | commit message does not match `^[a-z0-9][a-z0-9+.-]*: ` |
| W122 | warning | commit subject longer than 72 characters |
| L019 | info | `PKGDEP` empty (legal for meta packages, so info only) |

Known `ABTYPE` set: `self, autotools, cmake, waf, plainmake, haskell, perl, python, qtproj, ruby, gomod, rust, npm, meson`.
(`cargo` is not a separate template on current Autobuild4 — Rust packages use `rust`.)
Canonical `PKGSEC` set: fetch once from `https://raw.githubusercontent.com/AOSC-Dev/autobuild4/master/sets/section`
and embed a static fallback copy in `lib/lint.js` (a snapshot is fine; note the source URL in a comment).

Parsing rules: shell-assignment files may contain comments, quoted multi-line values and
backslash continuations; a malformed line is an E101/E102 issue with its line number, not a crash.

### 5.3 `aosc_scaffold_package`

Input:
```json
{ "treeRoot": "/abs/tree", "pkgname": "hello", "ver": "2.12.1", "section": "utils",
  "description": "A hello world demo program", "sources": ["https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz"],
  "abtype": "autotools", "depends": ["glibc"], "buildDepends": [], "recommends": [],
  "noarch": false, "rel": null, "epoch": null, "overwrite": false }
```
`treeRoot` is the ABBS tree checkout; the package directory is `<treeRoot>/<pkgname>`.
`depends`/`buildDepends`/`recommends` accept an array or a space-separated string.
`$VER` in sources must be preserved literally in `spec`.

Behavior: validate inputs first (name regex, section, description style) and throw a
comma-joined message before touching disk; refuse an existing directory unless
`overwrite === true`; create `spec` and `autobuild/defines`; run the linter on the result.

Output: `{ "packageDir": "...", "created": ["spec", "autobuild/defines"], "spec": "...", "defines": "...", "lint": { ...lint output... }, "warnings": ["..."] }`
(with full file text so the agent can review before committing).

Generated `spec` shape:
```
VER=2.12.1
REL=0                # only when explicitly provided
EPOCH=1              # only when explicitly provided
SRCS="tbl::https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz"
CHKSUMS="SKIP"       # placeholder; scaffold warns that it must be filled
```
No sources → `DUMMYSRC=1` and no `CHKSUMS`.

Generated `defines` shape:
```
PKGNAME=hello
PKGSEC=utils
PKGDES="A hello world demo program"
PKGDEP="glibc"
BUILDDEP=""
PKGRECOM=""
ABTYPE=autotools
ABHOST=noarch        # only when noarch
```

### 5.4 `aosc_checksum_source`

Input: `{ urls: string[], algorithm?: "sha256"|"sha512"|"sha1", timeoutMs?: number }`
(defaults: `sha256`, `20000`).

Output: `{ "sources": [{ "url": "...", "finalUrl": "...", "algorithm": "sha256", "checksum": "…", "size": 123 }], "chksums": "sha256::… sha256::…" }`

Implementation: global `fetch`, redirects followed, stream `response.body` through
`crypto.createHash`, AbortController for the timeout and `execution.signal`, reject
non-2xx. Cap at 256 MiB per source with a clear error. Never write the file to disk.

### 5.5 `aosc_topic_plan`

Input:
```json
{ "packages": ["nano"], "kind": "update", "version": "7.2", "purpose": "build-fix",
  "summary": "nano: update to 7.2", "canonicalPkg": null, "date": "2026-11-13",
  "labels": ["enhancement"], "arch": "amd64" }
```
`kind`: `new | update | security | change | rebuild | drop`. `packages` is in **build order**.

Output:
```json
{ "branch": "nano-7.2",
  "commitMessage": "nano: update to 7.2",
  "commitBody": "- ...",
  "prTitle": "nano: update to 7.2",
  "prBody": "markdown…",
  "builditCommands": { "openpr": "/openpr nano: update to 7.2;nano-7.2;nano;enhancement", "pr": "/pr <PR_NUMBER>", "build": "/build nano-7.2 nano amd64" },
  "warnings": [],
  "checklist": ["…"] }
```

Naming/commit rules per the AOSC topic and styling manuals:
- update: branch `<pkg>-<ver>`, commit `<pkg>: update to <ver>`
- security: branch `<pkg>-<ver>`, commit `<pkg>: security update to <ver>`
- new: branch `<pkg>-new`, commit `<pkg>: new, <ver>`
- change: branch `<pkg>-<ver>-<purpose>` (or `<pkg>-<purpose>` when version omitted), commit `<pkg>: <purpose>`
- drop: branch `<pkg>-drop`, commit `<pkg>: drop, orphaned`
- rebuild: branch `planned-rebuild-<YYYYMMDD>`, commit `rebuild …`
- multi-package: branch uses `canonicalPkg` + version; warn when it is missing.

`prBody` must include: a one-paragraph summary, the package list in build order, a test
plan mentioning `oma topics`, and a checklist covering the styling manual, one clean
BuildKit per package, and a stable rebuild after merge. `builditCommands.openpr` omits
the label segment when `labels` is empty and includes arch only when provided.

### 5.6 `aosc_build_plan`

Input: `{ packages: string[], instance?: string, arch?: string, topic?: string, workspace?: string }`
(defaults: `main`, null, null, null).

Output:
```json
{ "prerequisites": [{ "command": "ciel --version", "purpose": "…", "required": true }],
  "phases": [{ "name": "Prepare the build environment", "commands": [{ "cmd": "ciel new", "purpose": "…", "optional": false }] }],
  "notes": ["…"],
  "checklist": ["…"] }
```
Phases, in order: prerequisites/workspace, tree checkout + topic branch, build, package
inspection, install/test, commit + PR via BuildIt!, post-merge stable rebuild, repository
release via p-vector. Commands must be copy-paste correct (`ciel build -i <instance> <pkg>`,
`git clone https://github.com/AOSC-Dev/aosc-os-abbs`, `git checkout -b <topic>`,
`oma topics`, `git rebase stable`). Notes must state that Ciel needs Linux + root +
10 GiB, one clean BuildKit per package, and that the final stable rebuild is mandatory.

## 6. Skill contract (`skills/aosc-packaging/SKILL.md`)

Front matter is optional; the registered `description` is supplied by `lib/index.js`.
Body target 180–320 lines, English, imperative, no marketing. It must let an agent run the
whole AOSC OS packaging loop without further reading:

1. What AOSC OS is and its rolling/topic release model (Core versioning, `stable` only).
2. Toolchain map: ABBS tree, ACBS, Autobuild4, Ciel/BuildKit, oma, BuildIt!, p-vector, aoscbootstrap.
3. Environment setup: `ciel new`, `ciel update-os`, `ciel config -g`, disk/root requirements.
4. Package anatomy: `spec`, `autobuild/{defines,prepare,patch,build,beyond,patches,overrides,pax}`.
5. `spec` variables and the version-normalisation rules (dashes→`+`, underscores→`.`, `~rc`, date versions, git versions).
6. `defines` variables, dependency rules (E432: every direct ELF dependency in `PKGDEP`), BuildKit-provided packages.
7. Choosing `ABTYPE`; when to override with `autobuild/build`.
8. Packaging policy: no split packages, languages in the main package, telemetry removed/disabled, no API docs by default, `/usr` not `/opt`, file-placement table, desktop/Electron layout.
9. Build loop: branch → build → inspect `.deb` in `OUTPUT-stable/debs` → install/test → iterate.
10. Topic workflow: branch naming, one clean BuildKit per package, PR, `oma topics` testing, merge → tag → stable rebuild.
11. Commit message table (new/update/security/fix CVE/change/FTBFS/drop/arch/noarch) and long-message format.
12. BuildIt! commands (`/login`, `/openpr`, `/pr`, `/build`, `/status`), including the build-order comma rule.
13. p-vector release steps (`scan`, `release`, `sync`, `analyze`) and the QA issue-code classes E1xx/E2xx/E3xx/E4xx.
14. Image/ISO release with aoscbootstrap and the `repo.aosc.io/debs` mirror default.
15. A "use the dsh tools" section mapping each of the six tools to a step.
16. Troubleshooting: FTBFS, E401/E411/E431/E432, checksum mismatch, `~pre` suffix on non-stable branches.

`references/` must contain at least `spec-reference.md`, `defines-reference.md`,
`workflow-commands.md`, `qa-codes.md`. Link them from `SKILL.md` with relative paths.
Every non-obvious fact must have a source URL in `docs/SOURCES.md`.

## 7. Metadata contract (p8-docs)

- `locale/en.json`: `meta.title` = "AOSC OS packaging"; `meta.description` = one paragraph
  covering the six tools, the bundled skill, the read-only/network behavior, and that builds
  still require a Linux host with Ciel. `meta.detail` = "docs/DETAIL.md".
- `locale/zh.json`: same fields in Simplified Chinese.
- `docs/DETAIL.md`: exactly one image line: `![AOSC OS packaging toolkit](preview.svg)`.
- `docs/preview.svg`: self-contained 640×300, no text/fonts/scripts, readable in light and dark.
- `icon.svg`: original, simple, recognizable (package box + terminal prompt motif), no text.
- `README.md` / `README.zh-CN.md`: install commands, tool table, skill name, requirements,
  example prompts, marketplace note, license. No claims beyond the contract.
- `docs/MARKETPLACE.md`: exact catalog entry line for
  `awesome-dsh-plugin/awesome-dsh-plugin` (category "Tools & Capabilities"), plus the
  PR steps and a verification checklist.
- `LICENSE`: MIT, `Copyright (c) 2026 HougeLangley`.

## 8. Definition of done (every worker)

- Your own files exist, are syntactically valid, and contain no placeholder text.
- `cd /Users/suyeqin/dsh-aosc-packaging && node --test "tests/**/*.test.mjs"` passes (p8-core owns tests).
- `node --check` passes for every `.js` / `.mjs` you wrote.
- You report: files created, commands run, their real output, and anything left unverified.
- No "done" without evidence. A report without command output is rejected.

If a parallel worker's file is missing when you need it, read the contract instead — never
create or edit another worker's file.
