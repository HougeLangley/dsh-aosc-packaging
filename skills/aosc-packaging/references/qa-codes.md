# QA issue codes

AOSC OS packages are audited by machine, not by vibes. Issue codes are grouped in four
classes, and the `E`/`W` prefix is the severity: `E` is an error, `W` is a warning. Some
codes are listed as `E(W)`, meaning the same check can report either severity depending on
how the package fails it.

In p-vector's database, `pv_package_issues.level` records severity as `-1` critical, `0`
error, `1` warning; `errno` holds the code; `detail` holds a JSON payload with the specifics.

Sources for this file: `references/sources.md` entries `W-QA`, `W-PVECTOR`, `W-STYLING`.

## Class 1: metadata

| Code | Severity | Meaning | Fix direction |
| --- | --- | --- | --- |
| E101 | error | Syntax error(s) in `spec` | Read the reported line. Usual suspects: unclosed quote, a continuation backslash followed by trailing whitespace, `SRCS` and `DUMMYSRC` both present, `CHKSUMS` count not matching `SRCS` count. |
| E102 | error | Syntax error(s) in `defines` | Same, plus a variable name that is not a known Autobuild variable still parsed as Bash. Quote values that contain spaces. |
| E103 | error | Package name is not valid | Match `^[a-z0-9][a-z0-9+.-]*$`; a single character is legal (upstream example `r`). Underscores, uppercase letters and a leading digit-plus-nothing are the common causes. Rename the directory and `PKGNAME` together. |
| E104 | error | Package section is not valid | Use a canonical section from Autobuild4's `sets/section` (`utils`, `libs`, `devel`, `x11`, `Bases`, `non-free/...`, ...). `PKGSEC` does not have to match the directory name. |
| W111 | warning | Package may be out-dated | An update checker reports a newer upstream version. Update it, or set `CHKUPDATE` so the check is accurate. |
| W112 | warning | Source table uses HTTP | Switch to `https://`. If upstream only offers FTP, prefer a mirror that serves HTTPS. |
| W113 | warning | Source has no checksum | Compute `CHKSUMS`; `SKIP` is legal only for VCS sources. |
| W121 | warning | The last commit message was badly formatted | Use `<pkg>: <action>` — see the commit message table in `SKILL.md`. |
| W122 | warning | Multiple packages changed in the last commit | Split into one commit per package, or justify the bundle in the PR body. |
| W123 | warning | Force-pushed recently | Do not force-push a topic that a reviewer or the bot is already building; push a new commit or coordinate first. |

## Class 2: build process

| Code | Severity | Meaning | Fix direction |
| --- | --- | --- | --- |
| E201 | error | Failed to get source | Dead URL, moved tarball, wrong `$VER` substitution, or a `git::` ref that no longer exists. Reproduce the fetch outside the build. |
| E202 | error | Failed to get dependencies | `BUILDDEP` names something that is not in the repository or is not built for that architecture. Check spelling and the build order inside the topic. |
| E211 | error | Failed to build from source (FTBFS) | The build itself. Try `NOLTO=1`, `ABSHADOW=0`, `USECLANG=1`, then read the first error in the log. Port-specific fixes use `$VAR__$ARCH`. |
| E221 | error | Failed to launch packaged executable(s) | The binary is missing, not executable, or links something absent at runtime. Check `dpkg -c`, then `ldd` inside the package root. |
| W222 | warning | Feature(s) non-functional, or unit test(s) failed | A feature was disabled or broken at test time. Report it in the PR rather than shipping silently. |

## Class 3: payload

| Code | Severity | Meaning | Fix direction |
| --- | --- | --- | --- |
| E301 | error | Bad or corrupted `.deb` | The archive cannot be opened or its control data is unreadable. Rebuild; if it repeats, the packaging root is corrupt or the disk is full. |
| E302 | error/warning | `.deb` file too small | Size below 10 MB *and* below one third of the median package size. Usually a failed install step that produced an almost empty package. |
| E303 | error | Bad `.deb` filename or storage path | Files must be `pool/(lib)<initial>/<package>_<version>_<architecture>.deb`. Check the repository layout, not the package content. |
| E311 | error | Bad maintainer metadata | Must match `^.+ <.+@.+>$`, for example `Name <mail@example.org>`. Fix the identity used by Ciel/Autobuild, then rebuild. |
| E321 | error | Files stored in unexpected paths | Every path must be under `/usr/local` or match `^(bin\|boot\|etc\|lib\|opt\|run\|sbin\|srv\|usr\|var)/?.*`. The practical rule is `/usr`, not `/opt` and never `/`. |
| E322 | error/warning | Zero-byte file(s) in the `.deb` | An executable zero-byte file is an error unless it is a known empty marker (`NEWS`, `ChangeLog`, `INSTALL`, `TODO`, `COPYING`, `AUTHORS`, `README*`, `empty`, `placeholder*`, `.*`, `__init__.p*`). Ship nothing you did not intend to install. |
| E323 | error/warning | Bad owner/group | `uid > 999` or `gid > 999`. Files must be owned by root; a build running as a user leaks that uid into the package. |
| E324 | error/warning | Bad permission | A non-executable file in `/bin`, `/sbin`, `/usr/bin`, or a directory without the executable bit. Fix modes at install time (`install -Dvm755`, `-m644`). |
| E325 | error | File(s) not found in the `.deb` | The manifest expects paths the package does not contain — typically a renamed binary or a file moved by `beyond`. |
| W331 | warning | Package older than a year | Candidate for a version bump or a planned rebuild, not automatically a defect. |

## Class 4: dependencies

| Code | Severity | Meaning | Fix direction |
| --- | --- | --- | --- |
| E401 | error | `BUILDDEP` unmet | A declared build dependency is not satisfiable in the build environment. Drop entries that BuildKit already provides, and add the ones it does not. |
| E402 | error | Duplicate package in tree | Two directories produce the same `PKGNAME`. Merge or rename one of them. |
| E411 | error | `PKGDEP` unmet | A declared runtime dependency is not in the repository, or does not cover `Depends`, `Pre-Depends`, `Recommends` or `Suggests`. Add the missing package or remove the stale entry. |
| E412 | error | Duplicate package in repository | The same package/version/repo appears twice. Clean the pool and re-run `p-vector scan`. |
| E421 | error | File collision(s) | Two packages ship the same regular file for the same architecture and component, unless `Breaks`, `Replaces` or `Conflicts` is declared. Move the file or declare the relationship. |
| E431 | error | Library version (sover) dependency unmet | A dependent package requires a soname version the new build no longer provides. Rebuild every dependent in the same topic, or add `PKGBREAK` and rebuild after the merge. |
| E432 | error | Library dependency without `PKGDEP` | The package links a library whose providing package is not in `PKGDEP`. This is the rule packagers break most: add the provider even when the program runs fine without it being explicit. |

## How p-vector finds each code

`p-vector analyze` walks the PostgreSQL tables. The checks it documents:

| Code | Detection |
| --- | --- |
| 101 | Rows in `repo_package_basherr` where the package name is null — the tree file exists but no name could be parsed. |
| 102 | Rows in `repo_package_basherr` where the package name is not null — `defines` parsed, other fields did not. |
| 103 | Package name against `^[a-z0-9][a-z0-9+.-]*$`. Debian policy wants at least two characters, but p-vector allows one-character names as an exception. |
| 301 | `debtime` is null, i.e. the `.deb` could not be opened to read its control timestamp. |
| 302 | `size < 10 MB` and `size <` one third of the median package size. |
| 303 | Filename not of the form `pool/(lib)<initial letter>/<name>_<version>_<arch>.deb`. |
| 311 | Maintainer against `^.+ <.+@.+>$`. |
| 321 | Paths not under `/usr/local` and not matching `^(bin\|boot\|etc\|lib\|opt\|run\|sbin\|srv\|usr\|var)/?.*`. |
| 322 | Executable zero-byte files whose names are not `NEWS`, `ChangeLog`, `INSTALL`, `TODO`, `COPYING`, `AUTHORS`, `README`, `README.md`, `README.txt`, `empty`, `placeholder`, `placeholder.txt`, `.*`, `__init__.p*`. |
| 323 | `uid > 999` or `gid > 999`. |
| 324 | Non-executable file in `/bin`, `/sbin`, `/usr/bin`, or a non-executable directory. |
| 401 | Packages whose build dependencies are not found in the source tree. |
| 402 | Rows in `package_duplicate` (from `abbs.db`). |
| 411 | Packages whose `Depends`, `Pre-Depends`, `Recommends` or `Suggests` are not found in the related deb repositories. |
| 412 | Rows in `pv_package_duplicate`. |
| 421 | Pairs `p1`, `p2` sharing regular files, `p1 != p2`, same architecture (or `p2` is `all`), same repo component, `p1.testing <= p2.testing`, excluding pairs that declare `Breaks`, `Replaces` or `Conflicts`. |
| 431 | For package `p1`, find `p2` providing the needed library; if no version matches, fall back to the most popular provider of that so-name. Reports fuzzy matches and empty matches. |
| 432 | Recursively find the provider `p2` of the libraries `p1` needs, and report providers missing from `PKGDEP`. Missing dependencies inside `aosc-os-core` are not reported. A transitive case where `p1 -> p2 -> p3` and `p1` needs `p3` but declares no `PKGDEP` on it is not reported; when `p1` depends on or needs `p2`, `p2` depends on `p3`, and `p1` links `p3` without declaring it, it is reported. |

Codes `104`, `111`, `112`, `113`, `121`, `122`, `123`, `201`, `202`, `211`, `221`, `222`,
`325` and `331` are defined in the issue-code list but are not among the checks p-vector
documents on its own page. For those, the practical verification path is the build log,
the commit history and the artifact inspection described in `SKILL.md`.

## Working the codes

1. Run `p-vector config.yaml sync` before `analyze` on a fresh database; without the
   packages-site data, dependency checks have nothing to compare against.
2. Fix in bulk by class: metadata first (`E10x`, `W11x`), because a broken `spec` makes
   every other check unreliable.
3. Rebuild after any `defines` change; E4xx results are stale the moment a dependency moves.
4. `E431` and `E432` are fixed inside a topic, not by a follow-up. A soname bump without
   rebuilding dependents ships a broken repository.
5. Re-run `analyze` and compare `pv_issues_stats` counts before and after. "I fixed it" is
   a claim; a dropping issue count is evidence.
