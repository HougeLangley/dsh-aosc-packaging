# `spec` reference

`spec` sits at the root of the package directory and is read by ACBS only. It declares
the version, the revision, the sources and their checksums. The build system
(Autobuild4) never reads it; `autobuild/defines` is its file.

Sources for this file: `references/sources.md` entries `W-SPEC`, `W-STYLING`, `W-BASICS`.

## Variable summary

| Variable | Required | Syntax | Notes |
| --- | --- | --- | --- |
| `VER` | yes | `VER=<normalised-version>` | Upstream version, normalised per the table below. Must not contain underscores. |
| `REL` | no | `REL=<integer>` | Package revision, default `0`. Increment by 1 when the package changes without a `VER` change (for example an emergency patch). Omit the line when updating `VER`. Kernel release candidates use `0.1`, `0.2`, `0.3`, ... for RC numbers and `a`, `b`, `c`, ... for revisions of the same RC. |
| `EPOCH` | no | `EPOCH=<integer>` | Most significant version field, default `0`. Increment on a downgrade so the new package still sorts higher: `1:25.2` outranks `32.0`. |
| `SRCS` | unless `DUMMYSRC=1` | `SRCS="<spec> <spec> ..."` | Space separated source entries; see below. |
| `CHKSUMS` | when `SRCS` has non-VCS entries | `CHKSUMS="<algo>::<hash> ..."` | One entry per source, in `SRCS` order. `SKIP` for a VCS source. |
| `DUMMYSRC` | no | `DUMMYSRC=1` | Boolean. The package has no source, or ACBS cannot fetch it (meta packages, generated sources). |
| `SUBDIR` | no | `SUBDIR=<path>` | Directory ACBS changes into after preparing sources. `.` is legal and means the source root. |
| `CHKUPDATE` | recommended | `CHKUPDATE="<checker>::<args>"` | Upstream update checker; mark every package where a checker applies. `anitya::` is preferred where possible. |

`spec` and `SRCS` must not both be empty, and `DUMMYSRC` and `SRCS` together are
contradictory: pick one.

## Version normalisation

Every rule below is mandatory. The packager rewrites the upstream string; the tree never
stores what upstream happens to publish.

| Situation | Action | Example |
| --- | --- | --- |
| Dot-only version | Keep as upstream wrote it | GNOME Clocks 3.32.1 -> `VER=3.32.1` |
| Letters in the version | Lowercase every letter and delete the symbols around it | Bind 9.12.3-P4 -> `VER=9.12.3p4` |
| Dash | Replace each dash with `+` | ImageMagick 6.9.10-23 -> `VER=6.9.10+23` |
| Underscore | Replace each underscore with `.` | Icarus Verilog 10_2 -> `VER=10.2` |
| Pre-release stage notation (`alpha`, `beta`, `rc`, ...) | Lowercase the notation and prefix it with `~` | Golden Dict 1.5.0-RC2 -> `VER=1.5.0~rc2` |
| Date version | Replace dashes with dots | QuickJS 2020-09-06 -> `VER=2020.09.06` |
| Git or other VCS snapshot | Last tag, or `0` when never tagged, then `+`, the VCS name, then the commit date as `YYYYMMDD` | Shadowsocks `5ff694b2...` -> `VER=0+git20181219` |

The `~` prefix matters beyond cosmetics: dpkg sorts `1.5.0~rc2` *below* `1.5.0`, which is
exactly what a release candidate should do. Writing `VER=1.5.0rc2` breaks that ordering.

Underscores are forbidden in `PKGNAME` and `PKGVER`; use `.` or `+` instead.

## `SRCS`

Each entry takes one, two or three colon-separated fields:

| Form | Meaning |
| --- | --- |
| `<URL>` | Plain URL. ACBS fetches it and unpacks an archive if the payload is one. |
| `<TYPE>::<URL>` | Typed source. `tbl` for an archived tarball, `file` for a single file, `git` for a repository. |
| `<TYPE>::<OPTIONS>::<URL>` | Typed source with options. Join multiple options with semicolons. |

`tbl::` and `file::` are the everyday forms:

```
VER=4.24
SRCS="tbl::https://i3wm.org/downloads/i3-$VER.tar.xz"
CHKSUMS="sha256::5baefd0e5e78f1bafb7ac85deea42bcd3cbfe65f1279aa96f7e49661637ac981"
```

```
SRCS="file::https://some.domain/source_code_file"
CHKSUMS="sha256::<hash of that single file>"
```

VCS sources:

```
SRCS="git::https://github.com/AOSC-Dev/acbs"
CHKSUMS="SKIP"
```

Multiple sources, one `CHKSUMS` entry each, in order:

```
SRCS="git::commit=$COMMIT_ID::https://some.git.hosting/somewhere \
      tbl::https://some.domain/source_tarball.tar.gz \
      file::https://some.domain/source_code_file"
CHKSUMS="SKIP sha256::<hash> sha256::<hash>"
```

### `git::` options

| Option | Values | Behaviour |
| --- | --- | --- |
| `branch` | branch name | Check out that branch. |
| `commit` | commit hash, tag or `tags/<tag>` | Check out that revision. |
| `rename` | directory name (including extension) | Rename the fetched source so several git sources can coexist. |
| `submodule` | `true` / `false` / `recursive` | `true` fetches submodules non-recursively, `false` fetches none, `recursive` (default) fetches nested submodules. |
| `copy-repo` | `true` / `false` | `true` copies VCS metadata into the build directory before building and replaces `acbs_copy_git`; `false` (default) copies nothing. |

Options combine with semicolons:

```
SRCS="git::rename=lmms-git;commit=94363be::https://github.com/LMMS/lmms"
```

Two sources from the same repository need distinct names or two URLs:

```
SRCS="git::git://github.com/AOSC-Dev/acbs git::https://github.com/AOSC-Dev/acbs"
```

### Checksums

`CHKSUMS` is a space-separated list of `<algorithm>::<hash>` tokens, lowercase algorithm
name, one token per source in `SRCS` order:

```
CHKSUMS="sha1::a9c55882c935300bec93e209f1ec8a21f75638b7 sha256::4ccdbbd95d4aef058502c8ee07b1abb490f5ef4a4d6ff711440facd0b8eded33"
```

Generate it with `abbs-update-checksum <pkgname>` in the tree, or for a group of packages
with `acbs-build -gw <group-file>` inside `ciel shell`. The dsh tool
`aosc_checksum_source` produces the same token format from a URL.

`SKIP` is correct only for a VCS source. A `tbl::` or `file::` source with `SKIP` is a
lint error (`L004`) and defeats the whole point of the checksum.

### Deprecated variables

Do not write these in new packages; they exist for old ones. `SRCTBL` maps to
`tbl::`, `<VCS>SRC` to `<VCS>::`, `<VCS>BRCH` to `branch=`, `<VCS>COMMIT` to `commit=`,
and `CHKSUM` to a single `CHKSUMS` entry.

## Counter-examples

| Wrong | Why | Right |
| --- | --- | --- |
| `SRCS="tbl::https://x/hello-2.12.1.tar.gz"` | Hard-coded version; every update edits the URL and risks a stale checksum | `SRCS="tbl::https://x/hello-$VER.tar.gz"` |
| `VER=9.12.3-P4` | Dash and uppercase survive into the package version | `VER=9.12.3p4` |
| `VER=1.5.0rc2` | Sorts above 1.5.0 instead of below | `VER=1.5.0~rc2` |
| `VER=1.5.0_RC2` | Underscore is banned and `.` is required | `VER=1.5.0~rc2` |
| `SRCS="tbl::https://github.com/o/r/archive/v$VER.tar.gz"` | Forge-generated archives are regenerated and change checksum | `SRCS="git::commit=tags/v$VER::https://github.com/o/r"` |
| `SRCS="tbl::http://x/foo.tar.gz"` | Plaintext transport | `https://` where the host offers it, `ftp://` never |
| `CHKSUMS="SKIP"` next to a `tbl::` source | No verification at all | Compute the `sha256::` |
| `SRCTBL="http://..."` | Deprecated variable | `SRCS="tbl::https://..."` |
| `REL=0` on every update | Revision never advances, packages never upgrade | Drop the line, or bump only for a same-`VER` fix |
| `VER=32.0` after downgrading from 32.0 to 25.2 with no `EPOCH` | The downgrade is invisible to apt | `EPOCH=1` and `VER=25.2` |

## Revision marking on topic branches

ACBS appends a pre-release suffix to `REL` when building from a non-stable branch:
`$VER-$REL~pre<ISO8601 commit timestamp>`, for example `5.2.21-0~pre20240731T142407Z`.
If the tree has uncommitted changes it appends `~dirty` as well
(`2.40-0~pre20240805T024015Z~dirty`).

Rules that follow:

- A package travelling through the topic-to-stable pipeline shows exactly one `REL` bump.
- The timestamp is the Git *commit* timestamp of the ABBS tree, so it increments naturally.
- The suffix keeps topic builds lower than the final `REL` declared in `spec`, so users on
  the topic repository still receive the stable package at merge time.
- Never edit `REL` or the timestamp to hide the marker. It is the intended behaviour.
