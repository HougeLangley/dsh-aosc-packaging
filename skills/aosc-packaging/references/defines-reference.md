# `autobuild/defines` reference

`autobuild/defines` is a Bash file. Autobuild4 sources it, so any shell construct works,
but inline logic is deprecated: use `$VAR__$ARCH` suffixes instead. ACBS also reads it,
purely to compute build ordering.

Sources for this file: `references/sources.md` entries `W-AB3`, `W-STYLING`, `W-BASICS`,
`W-SPEC`, `G-DEVEL-BASE`, `G-CORE`.

## Package information

| Variable | Required | Value | Rule |
| --- | --- | --- | --- |
| `PKGNAME` | yes | package name | Lowercase, no underscore, matches `^[a-z0-9][a-z0-9+.-]*$`; single-character names are valid (upstream example `r`). |
| `PKGSEC` | yes | section | Must be a canonical section from Autobuild4's `sets/section`; anything else raises a QA warning. Not required to match the directory name (`desktop-wm/i3` uses `x11`). |
| `PKGDES` | yes | one-line description | Start with a capital letter, no trailing period or punctuation. Descriptive, not definitive: `Library with common API for various MATE modules`, not `MATE Desktop Library`. |
| `ABHOST` | no | `noarch` | Marks the package architecture-independent. |

`PKGVER` and `PKGREL` exist inside Autobuild (it derives them from `spec`); packagers do
not write them into `defines`. The version lives in `spec` only.

## Dependencies

| Variable | Meaning | Rules |
| --- | --- | --- |
| `PKGDEP` | Mandatory runtime dependencies, space separated | Must include every direct ELF-level dependency (QA code E432), plus glibc or the GCC runtime when that is the only dependency. |
| `BUILDDEP` | Build-time-only dependencies | Only what BuildKit does *not* already ship. Declaring `cmake`, `gcc`, `make` or `pkg-config` is noise; declaring `bazel` is correct. |
| `PKGRECOM` | Recommended dependencies | Installed automatically, removable at the user's discretion. |
| `PKGBREAK` | Packages broken by this package or its update | ABI or dependency breakage; drives rebuild decisions. |
| `PKGCONFL` | Conflicting packages | Mainly file conflicts. |
| `PKGREP` | Packages replaced or obsoleted | Used when renaming or merging packages. |
| `VER_NONE` | `1` disables versioned dependencies | Used by meta packages and base packages whose dependencies are version-agnostic. |
| `PKGPROV` | Virtual provides | Use sparingly; documented by example only. |

Dependency discipline:

- E432 is the one rule packagers get wrong most. A program that links `libdbus` needs
  `dbus` in `PKGDEP` even when it starts fine without it, because the linkage is what the
  QA check sees.
- Include transitive *runtime* requirements only when the linked ELF genuinely needs them;
  leaning on another package's dependencies is what E411 catches.
- `PKGDEP` may legitimately be empty for a meta package; lint reports that as info, not an
  error.
- A soname bump requires rebuilding every dependent in the same topic, otherwise users hit
  E431.

## Build-time environment

| Variable | Default | Effect |
| --- | --- | --- |
| `AB_FLAGS_O3` | `0` | Switch optimisation between `-O2` and `-O3`. Used mainly for Core. |
| `AB_FLAGS_SPECS` | `1` | Compiler and linker hardening specs (PIE/PIC); replaces the old `AB_FLAGS_PIE`/`AB_FLAGS_PIC` flags. |
| `AB_FLAGS_SSP` | `1` | Stack smashing protection. |
| `AB_FLAGS_FTF` | `1` | Fortify source. |
| `AB_FLAGS_RRO` | `1` | Read-only relocations. |
| `NOLTO` | `0` on amd64, `1` elsewhere | Disable link-time optimisation. First thing to try on a link-stage FTBFS. |
| `USECLANG` | `0` | Build with Clang instead of GCC. Fixes some Rust linkage problems; breaks some ports. |
| `AB_FLAGS_PIE` / `AB_FLAGS_PIC` | `1` | Clang-specific PIE/PIC switches after the Core 4 compatibility update. |
| `ABSHADOW` | `1` | Shadow build in a separate directory. Set `0` for sources that break when the build directory differs from the source root. |
| `ABCONFIGHACK` | `0` | Refresh `config.guess`/`config.sub` so old trees build on new architectures. |
| `ABCLEAN` | `1` | Clean source, build and packaging roots before a repeat build. |
| `ABTHREADS` | `$(nproc)+1` | Parallel job count for make. |
| `NOPARALLEL` | `0` | Force `ABTHREADS=1`. |
| `ABSTRIP` | `1` | Strip `.debug`, `.comment` and similar sections before packing. Set `0` for prebuilt binaries. |
| `ABSPLITDBG` | `0` for noarch, `1` otherwise | Detach debug symbols into `${PKGNAME}-dbg`. A `-dbg` package is produced only when the ELF has a SHA1 build-id, a symbol file carries `.debug_*` sections, and at least one symbol file exists, which is why Go and Rust packages often disable it. |
| `MAKE_AFTER` | empty | Extra arguments appended to `make`. |
| `FAIL_ARCH` | empty | Restrict the package to matching architectures, for example `"!(mainline|retro)"`. |

Per-architecture overrides use the `$VAR__$ARCH` suffix and need no shell branching:

```
AUTOTOOLS_AFTER__AMD64="-march=x86-64-v2"
USECLANG__LOONGSON3=0
NOLTO__LOONGSON3=1
PKGDEP__RETRO="aosc-aaa bash zlib"
```

`$ARCH` values in use include `AMD64`, `ARM64`, `LOONGSON3`, `PPC64EL`, `RISCV64`,
`RETRO`, `ARMV7HF`, `I486`.

## Path variables

| Variable | Points at | Use for |
| --- | --- | --- |
| `$SRCDIR` | Source root, where the build was invoked | Reading sources; always quote it: `"$SRCDIR"/configure`. |
| `$BLDDIR` | Shadow build root, when `ABSHADOW=1` | Intermediate build output. |
| `$PKGDIR` | Packaging root, a fake system root | Installing files that will become the `.deb`. |
| `$SYMDIR` | Debug packaging root | Debug symbols detached from `$PKGDIR`. |

Never install into `/`. Everything the package ships goes into `"$PKGDIR"`, and Autobuild
packs that directory.

If the script has `cd`-ed into a directory, the quoting rule relaxes for paths relative to
that directory, but absolute references must still go through these variables.

## Files under `autobuild/` and when they run

| Path | Kind | Runs | Notes |
| --- | --- | --- | --- |
| `defines` | sourced Bash | Always, first | All variables above. |
| `prepare` | sourced Bash | Before the build, after source fetch | May be sourced repeatedly when a source tree is reused, so make it idempotent. |
| `patches/` | data | Before the build, after `prepare` | `.patch` and `.diff`, applied at strip level 1 in filename order. A `series` file overrides the order. `*.patch.$ARCH` and `*.diff.$ARCH` apply only on that architecture. |
| `patch` | sourced Bash | Instead of the automatic patch step | Sourced once; a marker file prevents repeats. Use it when patches need `-p2` or are not patch files. |
| `build` | sourced Bash | Replaces the template build | Locks `ABTYPE` to `self` unless `ABTYPE=` overrides it. Must report progress with `abinfo` and warnings with `abwarn`. |
| `beyond` | sourced Bash | After the build, before packing | Post-build fixups: moving misplaced files, installing completions from the packaging root. Ignored for `ABTYPE=self`. |
| `overrides/` | data | Merged into `$PKGDIR` at pack time | Filesystem layout mirrors the target root: `autobuild/overrides/usr/share/applications/foo.desktop`. |
| `pax` | data | After installation | `abpaxctl <flags> <path>` lines for PaX/Grsecurity compatibility. |

`autobuild/build` example, with the required reporting:

```
abinfo "Installing Hugo binary ..."
install -Dvm755 hugo \
    "$PKGDIR"/usr/bin/hugo
```

`abinfo` and `abwarn` write to the build log and replace comments as the progress report.
Progression reporting is mandatory for `ABTYPE=self` packages.

## `ABTYPE` selection and override

`ABTYPE` names the build template. Declare it explicitly in every package: the styling
manual requires it, and lint treats a missing `ABTYPE` as an error even though Autobuild4
can guess.

Detection fallback order, when no `ABTYPE` is given: `self`, `autotools`, `autosetup`,
`cmake`, `cmakeninja`, `waf`, `plainmake`, `haskell`, `perl`, `python`, `pep517`,
`qtproj`, `ruby`, `gomod`, `rust`, `npm`, `dune`, `meson`. Lower prefixes win, which is
why autotools beats cmake in a tree that ships both `configure` and `CMakeLists.txt`.

| ABTYPE | Detection signal | Notes |
| --- | --- | --- |
| `self` | `autobuild/build` present | Your script is the build. |
| `autotools` | `configure` in the source root | `RECONF` controls re-running autotools; `AUTOTOOLS_DEF`/`AUTOTOOLS_AFTER` pass arguments. |
| `autosetup` | `auto.def`, `configure`, `autosetup/` | |
| `cmake` | `CMakeLists.txt` | `CMAKE_DEF`/`CMAKE_AFTER`. |
| `cmakeninja` | `CMakeLists.txt` | Same, but generates Ninja files. |
| `meson` | `meson.build` | Generates and runs Ninja. |
| `waf` | `waf` script | `WAF_DEF`/`WAF_AFTER`. |
| `plainmake` | Hand-written `Makefile` | |
| `haskell` | Cabal/Hackage tree | Register/unregister helpers. |
| `perl` | CPAN tree | |
| `python` | `setup.py` | `NOPYTHON2`/`NOPYTHON3` default 0. |
| `pep517` | `pyproject.toml` | Preferred over `python` where possible. |
| `ruby` | RubyGems tree | |
| `gomod` | `go.mod` | `GO_BUILD_AFTER` passes flags, commonly `-ldflags` for version strings. |
| `rust` | `Cargo.toml` | `CARGO_AFTER` enables features. |
| `npm` | `package.json` | |
| `dune` | Dune-based OCaml tree | |
| `qtproj` | `.pro` files | `QT_SELECT` picks 4, 5 or default. |
| `dummy` | none | Produces an empty package, for meta packages. |

Override rules:

- If `autobuild/build` exists and `ABTYPE` is anything other than `self`, the template's
  build script runs and your file is ignored. Lint flags this combination.
- If `ABTYPE=self` is declared without `autobuild/build`, the build produces nothing.
- `beyond` is executed only for non-`self` ABTYPEs; with `self`, put the fixups in `build`.
- Templates supply `DEF` and `AFTER` variables. `DEF` holds the defaults from
  `$AB/etc/autobuild/ab3_defcfg.sh`; `AFTER` adds to them, and can override them.

## BuildKit contents

BuildKit is a base AOSC OS with no kernel, plus basic development tools including
Autobuild4 and ABBS. The `aoscbootstrap` buildkit recipe is
`acbs admin-base autobuild4 core-base debug-base devel-base editor-base git network-base
python-base systemd-base util-base web-base`.

`devel-base` is a meta package whose `PKGDEP` is the standard toolchain:

```
binutils bison diffutils flex gawk gcc groff libtool m4 make patch pkg-config sed
autoconf automake cmake gettext help2man texinfo meson ninja git
```

`core-base` supplies the C runtime side (`aosc-aaa bash gcc-runtime zlib`), and glibc and
gcc are part of the `core` group of the tree. All of it is present before your build
starts, so none of it belongs in `BUILDDEP`.

Consequence: if a build works locally but fails in a fresh BuildKit, the missing piece is
almost certainly a `BUILDDEP` you forgot, or a `BUILDDEP` you dropped because it "felt
standard".

## Minimal complete example

```
PKGNAME=hello
PKGSEC=utils
PKGDEP="glibc"
PKGDES="A hello world demo program"
ABTYPE=autotools

RECONF=0
```

`RECONF=0` here is deliberate: Autobuild4 regenerates `configure`, which breaks this
particular tarball. It is a per-package workaround, not a house style.
