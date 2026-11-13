# Workflow and commands, zero to published

The whole AOSC OS packaging loop as an ordered command list. Every step states what must
be true before you run it, what success looks like, and where to look when it fails.

Sources for this file: `references/sources.md` entries `W-BASICS`, `W-TOPIC`, `W-STYLING`,
`W-ADV`, `W-BUILDIT`, `W-PVECTOR`, `W-CIEL`, `W-VERSION-SUFFIX`, `W-REPO-META`,
`G-CIEL`, `G-BOOTSTRAP`, `G-OMA`, `G-BUILDKIT`.

## Stage 0: environment

| Requirement | Check |
| --- | --- |
| Linux host with systemd-nspawn | `systemctl --version` works, `systemd-nspawn --help` exists |
| root | `id -u` prints `0` |
| ~10 GiB free on the workspace partition | `df -h .` |
| network access to the AOSC repositories | `curl -sI https://repo.aosc.io/debs` |

```sh
oma install ciel
```

Precondition: an AOSC OS host with `oma`. Expected: `ciel` on `PATH` (`ciel --help`
prints usage). On Arch Linux install from the AUR instead.

```sh
mkdir -p /root/ciel && cd /root/ciel
ciel new
```

Precondition: root, disk space. Expected: an interactive wizard. Choose the host
architecture as the target, enter maintainer information as `Name <mail@example.org>`,
accept the other defaults, and create one instance — conventionally `main`. Failure:
`ciel new` refuses to run as non-root, and a full disk leaves a half-initialised
workspace that must be removed before retrying.

```sh
ciel update-os
```

Precondition: instance exists. Expected: the BuildKit is refreshed to current packages.
This is the single best defence against "it built yesterday". Failure: a slow mirror;
change it first.

```sh
ciel config -g
```

Precondition: root. Expected: an editor opens the instance's `sources.list`. Save a faster
mirror and re-run `ciel update-os`.

```sh
git clone https://github.com/AOSC-Dev/aosc-os-abbs
cd aosc-os-abbs
git checkout stable
```

Precondition: `git`; a fork of the tree if you are not a contributor yet. Expected:
category directories such as `core-libs/`, `app-utils/`, `desktop-wm/`. Failure:
`stable` is protected for direct pushes, but cloning and branching are always allowed.

Optional:

```sh
echo 'CIEL_INST=main' > .env     # in the Ciel workspace root, drops -i main from builds
```

Ciel 3.0.6 and later finds the workspace root by walking up from the current directory,
so it is safe to run Ciel commands from inside the tree.

## Stage 1: the topic branch

```sh
git checkout stable && git pull
git checkout -b hello-2.12.1-new
```

Precondition: clean working tree. Expected: a branch named per the topic guidelines:

| Topic kind | Branch pattern | Example |
| --- | --- | --- |
| Update | `<pkg>-<ver>` | `nano-7.2` |
| Non-update change | `<pkg>-<ver>-<purpose>` | `gnome-shell-3.38.1-build-fix` |
| New package | `<pkg>-new` (guideline) or `<pkg>-<ver>-new` (basics) | `gnome-shell-ng-new`, `hello-2.12.1-new` |
| Multi-package | `<main>-<general ver>` | `gnome-3.38`, `boost-1.73` |
| Multi-package, multi-version survey | `<main>-survey-<YYYYMMDD>` | `rime-data-survey-20200928` |
| Planned rebuild | `planned-rebuild-<YYYYMMDD>` | `planned-rebuild-20201225` |

Rules that are easy to break: a topic is never reused, a topic should not force another
topic to rebase, and planned rebuilds take priority over every other topic.

## Stage 2: write the package

```sh
mkdir -p app-utils/hello && cd app-utils/hello
```

Precondition: on your topic branch, category chosen. Expected: an empty package directory
whose name equals `PKGNAME`.

Create `spec`:

```
VER=2.12.1
SRCS="tbl::https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz"
CHKSUMS="sha256::8d99142afd92576f30b0cd7cb42a8dc6809998bc5d607d88761f512e26c7db20"
```

Create `autobuild/defines`:

```
PKGNAME=hello
PKGSEC=utils
PKGDEP="glibc"
PKGDES="A hello world demo program"
ABTYPE=autotools

RECONF=0
```

```sh
abbs-update-checksum hello
```

Precondition: `spec` already written with a `SRCS` entry, network access. Expected: the
`CHKSUMS=` line rewritten with the real hash of the current tarball. Failure: a 404 URL, or
a version that no longer exists upstream. For a batch of packages, inside the tree run
`git --no-pager diff --name-only | grep spec | sed 's/\/spec//' > groups/my-changes`, then
`ciel shell` and `acbs-build -gw groups/my-changes`.

Syntax, options and inverted examples for `spec`: [spec reference](spec-reference.md).
Every `defines` variable: [defines reference](defines-reference.md).

## Stage 3: build

```sh
ciel build -i main hello
```

Precondition: instance `main`, BuildKit updated, package directory present, no other build
running. Expected: the log ends in `BUILD SUCCESSFUL`, and the package appears in
`OUTPUT-stable/debs` inside the Ciel workspace.

Failure triage, in order:

1. `Output of "configure" ...` or missing `install-sh` — try `ABSHADOW=0`.
2. Link-stage errors, huge RAM use — `NOLTO=1`.
3. Rust software failing to link against gcc objects — `USECLANG=1`.
4. Missing header or library — the package is not in BuildKit, so it belongs in
   `BUILDDEP`.
5. Checksum mismatch — the `CHKSUMS` line does not match the URL; rerun
   `abbs-update-checksum`.

## Stage 4: inspect the artifact

```sh
ls OUTPUT-stable/debs
dpkg -c OUTPUT-stable/debs/hello_*.deb
dpkg -I OUTPUT-stable/debs/hello_*.deb
```

Precondition: a successful build. Expected: one `.deb` per package; a file list that
matches the placement rules; a control file whose `Maintainer` is
`Name <mail@example.org>`, whose `Package`, `Version` and `Section` match `defines`, and
whose dependency fields match `PKGDEP`/`PKGRECOM`.

Look for: files outside `/usr`, docs that should not ship, test payload, world-writable
permissions, ownership other than root, and zero-byte files outside the accepted names.

## Stage 5: install and test

```sh
sudo dpkg -i OUTPUT-stable/debs/hello_*.deb   # or deb-installer, or oma
LANG=en_US.UTF-8 hello
```

Precondition: the artifact exists, you are on a disposable machine or container.
Expected: installs cleanly, the program runs, `hello` prints `Hello, World!`.

Test the package you actually changed: run the binary, exercise the plugin, load the
library. If the package is a rebuild, check that the dependent program still works. Record
what you ran — a PR reviewer will ask.

## Stage 6: commit

```sh
git add -A
git commit -m "hello: new, 2.12.1"
```

Precondition: build clean, tests done. Expected: one commit for a new package. If you
accumulated several, squash them: `git rebase -i stable`. Failure: a message that does not
match `<pkg>: <action>` is a QA warning (W121); multiple packages in one commit is W122.

The full commit message table lives in `SKILL.md`; the long form is:

```
syncthing: update to 2.0.3

- Use gomod template to build.
```

```sh
pakfixer
```

Precondition: inside the tree, Python 3. Expected: a review of your build script with
suggestions. It is advisory, not a gate.

## Stage 7: push and open the pull request

```sh
git rebase stable
git push origin hello-2.12.1-new
```

Precondition: your fork exists and is set as `origin`, `upstream` points at
`AOSC-Dev/aosc-os-abbs`. Expected: the branch on your fork, rebased on current `stable`.
Always rebase before opening the PR; the bot guidance says so explicitly.

Then either open the PR in the web UI directly, or use BuildIt! on Telegram:

| Step | Command | Expected reply |
| --- | --- | --- |
| Authenticate | `/login` | `Login successful!` after the GitHub flow |
| Open the PR | `/openpr <title>;<branch>;<pkg1,pkg2>[;<labels>][;<arch>]` | the PR, plus the labels and architectures it detected |
| Build the topic | `/pr <PR_NUMBER>` | build progress as PR comments, packages uploaded to the topic repository |
| Build one package | `/build <branch> <pkg> <arch>` | progress for that single package |
| Check the queue | `/status` | queue and server status |
| Help | `/help` | usage |

Argument order matters. `/openpr` fields are separated by semicolons, and the package list
is comma separated in **build order** — the first package builds first:

```
/openpr Editors Survey December 2023;editors-survey-20231231;nano,ed
/openpr Editors Survey December 2023;editors-survey-20231231;nano,ed;enhancement
/openpr Editors Survey December 2023;editors-survey-20231231;nano,ed;;amd64
/openpr nano: update to 7.2;editors-survey-20231231;nano,ed;enhancement;amd64
```

An empty field keeps the default for that field, which is why the arch-only form needs the
double semicolon. `/build` is space separated and takes exactly one package.

## Stage 8: testing and merge

```sh
oma topics
```

Precondition: an AOSC OS machine, topic packages uploaded. Expected: an interactive list of
topic repositories; enable the one matching your branch. Non-interactive form:
`oma topics --opt-in <topic>`. After enabling, refresh and upgrade, then re-run the tests
from stage 5 against the topic repository:

```sh
oma refresh && oma upgrade
```

A package is green-lit once it has been tested on each architecture in the topic. PR
review must highlight any conflict with the styling manual. When approved and merged, a
tag is created and the working branch is deleted.

One clean BuildKit per package is mandatory while building a topic: roll the environment
back to a bare BuildKit before building the next package. There is no exception.

## Stage 9: stable rebuild

```sh
git checkout stable && git pull
/pr <PR_NUMBER>
```

Precondition: the PR is merged. Expected: BuildIt! rebuilds every affected package against a
clean stable environment and uploads it to the stable repository. Old scratch builds are
archived.

The rebuild is not optional. Topic packages were built against the topic branch and carry a
`~pre<timestamp>` revision; the stable repository must get packages built from the merged
tree against stable, with the plain `REL`.

## Stage 10: repository release

```sh
p-vector config.yaml scan
p-vector config.yaml release
p-vector config.yaml analyze
```

Precondition: `config.yaml` with `db_pgconn` pointing at PostgreSQL, deb pool directories
populated. Expected: `scan` records every package, `release` writes `Packages`, `InRelease`
and `Contents` for apt, `analyze` populates `pv_package_issues` and `pv_issues_stats`.

| Subcommand | Purpose | When |
| --- | --- | --- |
| `scan` | Record packages from the deb directories into the database | After new `.deb`s land |
| `release [--force]` | Generate apt indices | After a successful scan |
| `sync` | Load the packages-site SQLite databases | Before analysis on a fresh database |
| `analyze [full]` | Detect packaging problems | After `sync` |
| `reset [pv\|sync]` | Drop tables | Destructive; only when rebuilding the database |

Then check the topic statistics (`pv_issues_stats`) to confirm the codes you fixed actually
disappeared. See [QA codes](qa-codes.md).

## Stage 11: images and ISOs

```sh
aoscbootstrap --branch stable --target /root/aosc --arch amd64 \
  --config aosc-mainline.toml --include "network-base systemd-base"
```

Precondition: `liblzma`, `nettle`, `zlib`, `arch-chroot`. Expected: a rootfs at `--target`.
Useful flags: `--mirror <URL>` (defaults to `https://repo.aosc.io/debs`),
`--include-files <list>`, `-1` (stage 1 only), `-x` (clean unmanaged files),
`-s <script>` (run after cleanup), `--export-tar-xz`, `--export-tar-gz`,
`--export-squashfs`.

Repository metadata lives in `/usr/share/repository-data/` (`mirror.toml`, `comps.toml`,
`template.toml`); user overrides go in `/etc/repository-data/` with unique IDs. The default
origin in `mirror.toml` is `https://repo.aosc.io/anthon/`.

## Failure quick reference

| Stage | Symptom | Where to look |
| --- | --- | --- |
| 0 | `ciel new` refuses | not root, or no systemd; check `id -u` and that nspawn exists |
| 0 | `nspawn exited too early (exit code 127)` | host page size larger than target page size; cross-build on another host |
| 3 | `BUILD SUCCESSFUL` missing | the last 200 lines of the build log; the first error, not the last |
| 3 | checksum mismatch | `spec` `CHKSUMS` versus the actual file at the URL |
| 4 | missing files or wrong paths | `defines` install rules, `autobuild/beyond`, `autobuild/overrides` |
| 6 | W121 / W122 | commit message format, one package per commit |
| 7 | `/openpr` rejected | field count and semicolons; packages must exist on the branch |
| 8 | package not visible in `oma topics` | build not uploaded yet; check `/status` |
| 9 | stable still serves the old version | the post-merge `/pr` build did not run or failed |
| 10 | `analyze` reports nothing | `sync` not run, or the deb pool paths are wrong |
