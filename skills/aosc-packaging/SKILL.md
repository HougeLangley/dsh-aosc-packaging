# AOSC OS packaging

Run the full AOSC OS loop: environment, `spec` and `autobuild/defines`, `.deb` build in a BuildKit, install test, topic pull request, BuildIt!, post-merge stable rebuild, p-vector release. Every rule here has a URL in the [source list](references/sources.md); when this file and the wiki disagree, the wiki wins.

## 0. Hard constraints

| Constraint | Consequence |
| --- | --- |
| Ciel needs Linux, root, ~10 GiB free | Only then can you run `ciel build`. |
| Non-Linux host (macOS, Windows, no nspawn) | Generate tree, `spec`, `defines`, commit text, PR body and BuildIt! commands. Say plainly that nothing was built. |
| No proof of output | The package is not built, tested, or installed. A plan is not a build. |

## 1. What AOSC OS is

Rolling-release, dpkg/apt based, no release version number, one user channel: `stable`. A subset of the `aosc-os-abbs` tree forms the **Core** (glibc, GCC, ...), which *is* versioned (Core 7.0.1, 7.1.1, ...); that major version sets the base library generation. All changes reach `stable` as **topics**: a branch, a pull request, builds into a separate topic repository that users opt into with `oma topics`, then merge, rebuild against a clean stable BuildKit, upload to the main repository.

## 2. Toolchain map

| Tool | Role | When you touch it |
| --- | --- | --- |
| ABBS tree (`aosc-os-abbs`) | Git tree of package directories | Always: where you commit. |
| ACBS | Reads tree, fetches sources, orders builds, hands off to Autobuild4 | Indirectly via `ciel build`. |
| Autobuild4 | Reads `spec` + `autobuild/*`, builds, packs the `.deb` | When a build or QA check fails. |
| Ciel / BuildKit | BuildKit = standard AOSC OS + dev tools, no kernel, run as systemd-nspawn + OverlayFS containers | `ciel new`, `ciel update-os`, `ciel build`, `ciel shell`; roll back between packages. |
| oma | Package manager; enrolls topic repositories | Install tests, `oma topics`. |
| BuildIt! | Telegram bot: PRs, topic builds, uploads | Every topic after the push. |
| p-vector | Deb repository, apt indices, QA analysis | Release and QA triage. |
| aoscbootstrap | Bootstraps a rootfs from a mirror | Image work only. |

Ciel plugins are `ciel-*` executables in `/usr/libexec/ciel-plugin`; `ciel build` is one.

## 3. Environment setup

Run everything as root on Linux (`sudo -i`, so `~` is `/root`, or prefix each command).

```sh
oma install ciel          # AOSC OS host; on Arch use the AUR package. Verify: ciel --help
mkdir -p /root/ciel && cd /root/ciel
ciel new                  # wizard: host arch, maintainer Name <mail@example.org>, one instance "main"
ciel update-os            # refresh BuildKit; stale BuildKits cause mysterious FTBFS
ciel config -g            # edit sources.list for a faster mirror, then re-run ciel update-os
git clone https://github.com/AOSC-Dev/aosc-os-abbs
cd aosc-os-abbs && git checkout stable
```

Expect category directories (`core-libs/`, `app-utils/`, `desktop-wm/`). Optional: put `CIEL_INST=main` in a `.env` at the Ciel workspace root to drop `-i main` later.

## 4. Package anatomy

```
hello/
├── spec                 # VER, REL, EPOCH, SRCS, CHKSUMS, SUBDIR, CHKUPDATE
└── autobuild/
    ├── defines          # PKGNAME, PKGSEC, PKGDES, deps, ABTYPE
    ├── prepare          # pre-build shell; sourced, may repeat across rebuilds
    ├── patch            # optional; replaces the automatic patch step; sourced once
    ├── patches/         # *.patch / *.diff, applied -p1 in filename order
    ├── build            # your own build script; locks ABTYPE=self
    ├── beyond           # post-build fixups; non-self ABTYPE only
    └── overrides/       # extra files, laid out as they land in / (pax: abpaxctl lines)
```

The directory name and `PKGNAME` normally match; `PKGSEC` is the section and need not match the directory (`desktop-wm/i3` has `PKGSEC=x11`).

## 5. `spec`

Read by ACBS only, at the package root.

| Variable | Meaning | Rule |
| --- | --- | --- |
| `VER` | Upstream version | Required, normalised. |
| `REL` | Revision | Optional, default 0. Bump by 1 for a no-version-change fix; drop the line on updates. Kernel RCs use `0.1`, `0.2`, `0.3` then `a`, `b`, `c`. |
| `EPOCH` | Most significant version field | Optional, default 0. Bump on downgrade so `1:25.2` still sorts above `32.0`. |
| `SRCS` | Sources | Required unless `DUMMYSRC=1`. |
| `CHKSUMS` | One checksum per source, space separated | `SKIP` for VCS sources only. |
| `DUMMYSRC` | No sources / meta package | `1` when nothing is downloadable. |
| `SUBDIR` | Directory to enter after unpacking | Path string. |
| `CHKUPDATE` | Upstream update checker | Mark it whenever a checker exists. |

Normalisation is mandatory:

| Upstream | `VER=` | Rule |
| --- | --- | --- |
| 3.32.1 | `3.32.1` | Dots only: unchanged. |
| 9.12.3-P4 | `9.12.3p4` | Lowercase letters, strip surrounding punctuation. |
| 6.9.10-23 | `6.9.10+23` | Dash to plus. |
| 10_2 | `10.2` | Underscore to dot. |
| 1.5.0-RC2 | `1.5.0~rc2` | Lowercase stage, prefix `~`. |
| 2020-09-06 | `2020.09.06` | Date version: dash to dot. |
| git 5ff694b, untagged | `0+git20181219` | Tag (or `0`) `+` VCS `+` commit date. |

Source entries are `<URL>`, `<VCS>::<URL>`, or `<VCS>::<OPTIONS>::<URL>`; join options with `;`. Options: `branch`, `commit`, `rename`, `submodule`, `copy-repo`.

```
VER=2.12.1
SRCS="tbl::https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz"
CHKSUMS="sha256::8d99142afd92576f30b0cd7cb42a8dc6809998bc5d607d88761f512e26c7db20"
```

Substitute `$VER` in URLs; never use forge-generated archives from GitHub/GitLab (`/archive/`, generated `tar.gz`) because they are regenerated with different checksums. Use `git::commit=tags/v$VER::...` instead. Syntax, options and counter-examples: [spec reference](references/spec-reference.md).

## 6. `defines` and dependencies

`autobuild/defines` is Bash, sourced by Autobuild4.

| Variable | Purpose |
| --- | --- |
| `PKGNAME` `PKGSEC` `PKGDES` | Required identity. Name: lowercase, `^[a-z0-9][a-z0-9+.-]*$`, no underscore; single-character names are legal (upstream example: `r`). |
| `PKGDEP` | Runtime dependencies, space separated. |
| `BUILDDEP` | Build-only dependencies. Omit anything BuildKit ships. |
| `PKGRECOM` | Recommended, user-removable. |
| `PKGBREAK` `PKGCONFL` `PKGREP` | Breakage, file conflicts, obsoleted packages. |
| `ABTYPE` | Build template. Declare it explicitly; the styling manual requires it. |
| `ABHOST=noarch` | Architecture-independent package. |
| `ABSTRIP` `ABSPLITDBG` | Strip and split `-dbg`; default 1, and 0 for noarch. |
| `AB_FLAGS_*` `NOLTO` `USECLANG` `ABSHADOW` | Build environment switches. |

- **E432**: every direct ELF dependency must be in `PKGDEP`, not just what makes the
program run. If a binary links `libdbus`, `dbus` goes in.
- A sole dependency on the GCC runtime or glibc is still declared (`PKGDEP="glibc"`).
- Nothing already in BuildKit goes in `BUILDDEP`. BuildKit is base AOSC OS plus dev
tools: `devel-base` pulls `binutils bison diffutils flex gawk gcc groff libtool m4 make patch pkg-config sed autoconf automake cmake gettext help2man texinfo meson ninja git`, and `core-base` brings the C runtime. `cmake` is noise; `bazel` is correct.
- Per-architecture values use `$VAR__$ARCH` (`AUTOTOOLS_AFTER__AMD64`,
`USECLANG__LOONGSON3=0`), never `if` blocks; inline Bash logic is deprecated.

Every variable, every `autobuild/` file's execution order, and the ABTYPE override rules: [defines reference](references/defines-reference.md).

## 7. Choosing `ABTYPE`

Declare it always; let detection only confirm your choice.

| ABTYPE | Use when |
| --- | --- |
| `self` | You ship `autobuild/build`. Requires `abinfo` progress lines. |
| `autotools` / `autosetup` | `configure` in the source root / `auto.def` + `autosetup/`. |
| `cmake` / `cmakeninja` / `meson` | `CMakeLists.txt` (Make or Ninja) / `meson.build`. |
| `waf` / `plainmake` | `waf` script / hand-written `Makefile`. |
| `gomod` / `rust` / `npm` / `dune` | Go modules / Cargo / npm / OCaml Dune. |
| `perl` / `python` / `pep517` / `ruby` / `haskell` / `qtproj` | CPAN / `setup.py` / `pyproject.toml` / RubyGems / Cabal / `.pro`. |
| `dummy` | Empty meta package. |

Shipping `autobuild/build` locks the type to `self` unless `ABTYPE=` overrides it; the reverse holds too, so never leave a template named while a build script exists.

## 8. Packaging policy

| Rule | Detail |
| --- | --- |
| No split packages | One package unless upstream has genuine flavours or maintainers agree. |
| Language packs stay | Dictionaries, locale data and translations ship with the executables. |
| Telemetry stripped | Disabled by default, opt-in only; packages that break without it are rejected by default. |
| Update checkers stripped | No notification or download-on-check behaviour. |
| No API docs, no tests | No gtk-doc/Doxygen/HTML/PDF API docs unless an integrated feature needs them; ABBS runs no automated tests, so package no test code. |
| `/usr`, not `/opt` | Only a licence forbidding relocation justifies `/opt`, otherwise reject the package. Prebuilt binaries (binpack) also need `ABSTRIP=0`. |
| Quoting and comments | Quote every variable (`"$SRCDIR"`, `"$PKGDIR"`); every workaround carries `# FIXME:` with the reason. |

| Content | Path |
| --- | --- |
| Executables | `/usr/bin` |
| Shared and static libraries | `/usr/lib` |
| Private libraries | `/usr/lib/$COMPONENTNAME` |
| Binaries run by other programs | `/usr/libexec` |
| Architecture-independent data | `/usr/share` |
| Headers | `/usr/include` |
| Man pages | `/usr/share/man` |
| Licences and docs | `/usr/share/doc/$PKGNAME` |
| Daemon state | `/var/lib/$COMPONENTNAME` |

Electron/Chromium: `usr/bin` holds a symlink into `/usr/lib/$PKGNAME`, program data in `/usr/lib/$PKGNAME`, desktop and AppStream files in `/usr/share`.

Patch names `NNNN-$CATEGORY-$CONTENT.patch`. From a git source: `git format-patch -n $HASH` (n commits up to `$HASH`, inclusive) already emits the `nnnn-` prefix. Order matters: ship `autobuild/patches/series`. Non-`-p1` strip level: write `autobuild/patch` yourself.

## 9. Build loop

```sh
cd aosc-os-abbs
git checkout stable && git pull
git checkout -b hello-2.12.1-new     # topic branch name per section 10
ciel build -i main hello              # -i selects the instance used to build
ls OUTPUT-stable/debs                 # the .deb lands here, inside the Ciel workspace
```

Precondition for `ciel build`: `main` exists, BuildKit updated, package directory present. Expected: `BUILD SUCCESSFUL` in the output plus a `.deb` in `OUTPUT-stable/debs`. No `.deb`, no success.

```sh
dpkg -c OUTPUT-stable/debs/hello_*.deb       # file list: check paths against section 8
dpkg -I OUTPUT-stable/debs/hello_*.deb       # control: Maintainer "Name <mail@example.org>"
sudo dpkg -i OUTPUT-stable/debs/hello_*.deb  # or deb-installer; oma also works on AOSC OS
LANG=en_US.UTF-8 hello                       # expected: "Hello, World!"
```

Iterate here until the build is clean and the payload is right; never commit a package you have not seen build. Full command sequence with preconditions and failure triage: [workflow commands](references/workflow-commands.md).

## 10. Topic workflow

- One topic per package; exceptions only for waves that belong together (a desktop
environment, a rebuild forced by one soname bump).
- Branch names: update `<pkg>-<ver>` (`nano-7.2`); non-update `<pkg>-<ver>-<purpose>`
(`gnome-shell-3.38.1-build-fix`); new `<pkg>-new` (`gnome-shell-ng-new`), and the Basics guide also shows `<pkg>-<ver>-new` (`hello-2.12.1-new`); multi-package uses the main package plus its general version (`gnome-3.38`, `boost-1.73`); planned rebuilds `planned-rebuild-$(date +%Y%m%d)`.
- A topic is never reused. `stable` is protected: no direct commits, merge only through a
reviewed pull request.
- **One clean BuildKit per package.** Roll the environment back to a bare BuildKit before
building the next package. No exception. A build from a dirty environment is not evidence.
- `git rebase stable` before opening the PR, always.
- Topic packages carry `$VER-$REL~pre<ISO8601 commit timestamp>`
(`5.2.21-0~pre20240731T142407Z`), plus `~dirty` when the tree has uncommitted changes. This is intended: it keeps topic revisions below the final stable revision. Do not edit `REL` to hide it.

## 11. Commit messages

| Action | Format | Example |
| --- | --- | --- |
| New package | `<pkg>: new, <ver>` | `windowsnt-kernel: new, 5.1.2600` |
| Version update | `<pkg>: update to <ver>` | `mate-desktop: update to 1.22.0` |
| Security with bump | `<pkg>: security update to <ver>` | `firefox: security update to 142.0` |
| Security via patch | `<pkg>: fix <CVE>` | `samba: fix CVE-2025-0620` |
| Generic change | `<pkg>: <what, present tense>` | `kde-workspace: add qt-5 dependency` |
| Distribution patch | `<pkg>: (<dist> patch[es], <channel>) <what>` | `qt-4: (Arch Linux patches) rebuild for openssl` |
| Upstream patch | `<pkg>: (upstream patch[es]) <what>` | `kodi: (upstream patch) fix lock-up on start-up` |
| QA fix | `<pkg>: <what> (<CODE>)` | `psiconv: rebuild for imagemagick (E431)` |
| FTBFS work-in-progress | `<pkg>: <what> (FTBFS)` | `chromeos-desktop: update to 99.0.9999 (FTBFS)` |
| Arch-specific | `<pkg>: <what> (<arch>)` | `google-chrome: new, 100.0.9999.999 (amd64)` |
| Arch-independent | `<pkg>: <what> (noarch)` | `mate-common: update to 1.22.0 (noarch)` |
| Drop orphaned | `<pkg>: drop, orphaned` | `nano: drop, orphaned` |

One commit per new package: squash with `git rebase -i`. Subject over 50 characters, or more than one kind of change, means a long message:

```
syncthing: update to 2.0.3

- Use gomod template to build.
```

The body lists every material change: dependencies, enabled features, patches, flags.

## 12. BuildIt!

`@aosc_buildit_bot` on Telegram runs the mechanical half. It will not write your branch, edit the PR body, or test for you.

| Command | Syntax | Notes |
| --- | --- | --- |
| `/login` | `/login` | One-time GitHub auth; ends with `Login successful!`. |
| `/openpr` | `/openpr <title>;<branch>;<pkg1,pkg2>[;<labels>][;<arch>]` | Comma list is the build order, first builds first. Labels and arch are auto-detected; override by supplying them. Skip labels but keep arch: `...;nano,ed;;amd64`. |
| `/pr` | `/pr <PR_NUMBER>` | Builds and uploads to the topic repository; re-run after merge for `stable`. |
| `/build` | `/build <branch> <pkg> <arch>` | Space separated, one package: `/build editors-survey-20231231 nano amd64`. |
| `/status` `/help` | `/status`, `/help` | Queue and server status; usage. |

```
/openpr Editors Survey December 2023;editors-survey-20231231;nano,ed
/openpr nano: update to 7.2;editors-survey-20231231;nano,ed;enhancement;amd64
/pr 9999
/build editors-survey-20231231 nano amd64
```

Sequence: push to your fork, open the PR, `/pr <n>`, wait for green, install and test from the topic repository (`oma topics`), get an approval, merge, `/pr <n>` again to build and upload to `stable`.

## 13. p-vector and QA

```sh
p-vector config.yaml scan      # record packages in the database
p-vector config.yaml release   # generate Packages, InRelease, Contents for apt
p-vector config.yaml analyze   # write issues into pv_package_issues
```

Precondition: `config.yaml` with a PostgreSQL connection string. `release` also accepts `--force`; `sync` loads the packages-site SQLite databases; `reset [pv|sync]` drops tables.

| Class | Subject | Examples |
| --- | --- | --- |
| `E1xx` / `W1xx` | Metadata: `spec`, `defines`, commit hygiene | `E101` spec syntax, `E103` bad name, `E104` bad section, `W121` bad commit message |
| `E2xx` | Build process | `E201` source fetch, `E211` FTBFS, `E221` executable will not launch |
| `E3xx` | Payload | `E301` corrupt `.deb`, `E303` bad path, `E321` unexpected path, `E324` bad permission |
| `E4xx` | Dependencies | `E401` BUILDDEP unmet, `E411` PKGDEP unmet, `E421` file collision, `E431` sover, `E432` undeclared library dependency |

Full code table, the p-vector detection query behind each code, and fix directions: [QA codes](references/qa-codes.md).

## 14. Images and ISOs

```sh
aoscbootstrap --branch stable --target /root/aosc --arch amd64 \
  --config aosc-mainline.toml --include "network-base systemd-base"
```

Precondition: `liblzma`, `nettle`, `zlib`, `arch-chroot`. Expected: an AOSC OS rootfs at `--target`. `--mirror` defaults to `https://repo.aosc.io/debs`; the live repository origin is `https://repo.aosc.io/anthon/` in `mirror.toml`. Emit artifacts with `--export-tar-xz`, `--export-tar-gz` or `--export-squashfs`; `-1` stops after the base filesystem, `-x` cleans unmanaged files, `-s <script>` runs a script afterwards.

## 15. Using the dsh tools

Six tools cover the read-only and planning halves of this loop. None runs shell commands, none installs anything, and none substitutes for a real build: the `.deb` comes from Ciel on Linux.

| Tool | Step | What it does |
| --- | --- | --- |
| `aosc_inspect_package` | Before editing a package | Parses `spec` and `autobuild/defines` into structured data: `VER`, `REL`, `EPOCH`, `SUBDIR`, `DUMMYSRC`, sources with type/options/checksum, `CHKSUMS`, `PKGNAME`, `PKGSEC`, `PKGDES`, dependency arrays, `ABTYPE`, `ABHOST`, which `autobuild/*` files exist, patch count. Read-only. |
| `aosc_lint_package` | After editing, before `ciel build` | Applies the E1xx/L0xx naming, description, source, dependency, patch and `ABTYPE` rules, plus `W121`/`W122` when given a commit message. Read-only. |
| `aosc_scaffold_package` | Adding a package | Writes `<treeRoot>/<pkgname>/{spec,autobuild/defines}`, refuses to overwrite unless told to, returns the generated text and a lint run. `CHKSUMS="SKIP"` is a placeholder you must replace. |
| `aosc_checksum_source` | Filling `CHKSUMS` | Streams each URL through sha256/sha512/sha1 and returns the ready `CHKSUMS` string. The dsh equivalent of `abbs-update-checksum`; it downloads, so confirm the URL first. |
| `aosc_topic_plan` | Opening the topic | Emits branch name, commit subject and body, PR title and body, and the exact `/openpr`, `/pr`, `/build` lines for `new`, `update`, `security`, `change`, `rebuild` or `drop`. Planning only. |
| `aosc_build_plan` | Driving the loop, or planning on a non-Linux host | Emits ordered phases with prerequisites and copy-paste commands, from `ciel new` through the post-merge stable rebuild to `p-vector release`, including the Linux/root/10 GiB and one-clean-BuildKit notes. Planning only. |

Defensible order: `aosc_inspect_package`, edit, `aosc_lint_package`, `aosc_checksum_source`, scaffold or edit, `aosc_lint_package` again, `aosc_topic_plan`, `aosc_build_plan`, then run the commands on Linux. The tools are advisory: when a lint message and the wiki disagree, satisfy the wiki and say which rule you followed.

## 16. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `E211` FTBFS at link stage | LTO incompatibility | `NOLTO=1`. |
| autotools cannot find `install-sh`, source already configured | Shadow build | `ABSHADOW=0`. |
| `ld` errors building Rust software | LLVM backend vs gcc objects | `USECLANG=1`. |
| `ld.lld: relocation R_MIPS_64 ...` on loongson3 | `USECLANG` on that port | `USECLANG__LOONGSON3=0` and `NOLTO__LOONGSON3=1`. |
| `nspawn exited too early (exit code 127)` on LoongArch | Host page size exceeds target size; cross builds unsupported there | Build on another host architecture. |
| Checksum mismatch | Stale `CHKSUMS`, or a forge-generated archive | `abbs-update-checksum <pkg>` (or `acbs-build -gw <group>` inside `ciel shell`); switch to `git::commit=tags/v$VER`. |
| `E401` / `E411` | Missing build-time / runtime dependency | Declare it, or drop it if BuildKit already ships it. |
| `E431` | ABI break on a library | Rebuild dependents in the same topic, or add `PKGBREAK`. |
| `E432` | Direct ELF dependency absent from `PKGDEP` | Add the providing package. |
| `REL` shows `~pre2024...Z` or `~dirty` | Normal topic-branch revision marking | Expected; it disappears after the merge rebuild on `stable`. |
| `E101` / `E102` / `E103` / `E104` | Syntax error in `spec`/`defines`, bad name, bad section | Fix the reported line (quoting, continuations); match `^[a-z0-9][a-z0-9+.-]*$`; pick a section from Autobuild4's `sets/section`. |

Report a blocked build with the exact failing command, the first error line, what you verified, and which fixes you ruled out with evidence.
