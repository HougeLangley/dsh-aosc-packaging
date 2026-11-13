> 运行时副本（随技能分发，经 `resourceBase` 暴露）；仓库级副本在仓库的 `docs` 目录下，文件名 `SOURCES.md`。

# Sources

调研方式：全部页面于 **2026-11-13** 用 HTTP GET 实际抓取（`curl -sSL`），逐页阅读正文后
写入技能文件；下文每一行给出「支持哪条事实」以及该条属于**页面原文**还是**推断**。
凡是原始文档没有逐字支持、只能由其他事实推导的结论，均标注 `[推断]`；
凡是没有找到权威来源、因此没有写进 SKILL.md 或 references 的结论，列在第 3 节。

## 1. 来源总表

| 编号 | 主题 | URL | 支持的事实 | 类型 |
| --- | --- | --- | --- | --- |
| W-BASICS | 打包基础 | https://wiki.aosc.io/developer/packaging/basics/ | Ciel/ACBS/Autobuild4 分工；`oma install ciel`、`ciel new`、`ciel update-os`、`ciel config -g`、`ciel build -i main flac`；`.deb` 位于 `OUTPUT-stable/debs`；需要 Linux + root + 10 GiB；`RECONF=0` 的 hello 示例；`hello-2.12.1-new` 分支；`pakfixer`；提交后 PR 流程 | 原文 |
| W-STYLING | 包风格手册 | https://wiki.aosc.io/developer/packaging/package-styling-manual/ | VER/REL/EPOCH 规则与版本规范化表；SRCS 的 `$VER` 替换、禁止平台生成压缩包、HTTPS 优先；`abbs-update-checksum $PKGNAME`；CHKUPDATE；E432 要求直接 ELF 依赖入 PKGDEP；BuildKit 已含包无需入 BUILDDEP（cmake 例）；不拆分包、语言包随主包、遥测与更新检查必须移除、默认不装 API 文档；文件放置表；Electron 布局；binpack 不用 `/opt` 且 `ABSTRIP=0`；补丁命名 `NNNN-$CATEGORY-$CONTENT.patch`；`git format-patch -n $HASH`；完整 commit message 表；长提交格式 | 原文 |
| W-SPEC | ACBS spec 格式 | https://wiki.aosc.io/developer/packaging/acbs/spec-format/ | `spec` 必备 `VER`；`SRCS`/`DUMMYSRC` 二选一；`CHKSUMS`、`SUBDIR`；已废弃的 `SRCTBL`/`<VCS>SRC`/`<VCS>BRCH`/`<VCS>COMMIT`/`CHKSUM`；`<TYPE>::<OPTIONS>::<URL>` 与 `;` 连接多选项；`branch`/`commit`/`rename`/`submodule`（true/false/recursive）/`copy-repo`；多源与多校验和示例 | 原文 |
| W-AB3 | Autobuild3 手册 | https://wiki.aosc.io/developer/packaging/autobuild3-manual/ | defines 全部变量语义；`AB_FLAGS_*`、`NOLTO`、`USECLANG`、`ABSHADOW`、`ABTHREADS`、`ABSTRIP`、`ABSPLITDBG`（含 build-id 三条件）、`MAKE_AFTER`、`VER_NONE`；`$SRCDIR/$BLDDIR/$PKGDIR/$SYMDIR`；`prepare` 可重复 source、`patch` 只 source 一次、`build` 锁定 self、`beyond` 仅非 self、`overrides` 布局、`pax` 语法；补丁 `-p1`、`series`、`.patch.$ARCH`；`PKGSEC` 取自 `$AB/sets/section` | 原文 |
| W-AB4 | Autobuild4 页面 | https://wiki.aosc.io/developer/packaging/autobuild4/ | Autobuild4 是 Autobuild 后继；提供便利函数 | 原文 |
| W-ADV | 进阶教程 | https://wiki.aosc.io/developer/packaging/advanced-techniques/ | 当前支持的 ABTYPE 列表（含 autosetup/cmakeninja/dummy/dune/meson/pep517）；`abinfo`/`abwarn`；`$PKGDIR` 安装示例；`acbs-build -gw groups/...` 批量更新校验和；`groups/` 临时组、`commit-o-matic`；`.env` 的 `CIEL_INST`；Ciel ≥ 3.0.6 自动寻找 workspace root；「ABBS 不跑自动化测试，不要把测试代码打进产物」 | 原文 |
| W-ADV-ZH | 进阶教程（中文） | https://wiki.aosc.io/zh/developer/packaging/advanced-techniques/ | 上一条 ABTYPE 列表的中文对照，用于交叉确认术语 | 原文（补充） |
| W-TOPIC | topic 维护指南 | https://wiki.aosc.io/developer/packaging/topic-based-maintenance-guideline/ | rolling + 单一 stable 通道；topic 定义与规则；分支命名 `$PKGNAME-$PKGVER`、非更新 `$PKGNAME-$PKGVER-$PURPOSE`、新包可省略版本号（`gnome-shell-ng-new`）、多包用主包名、`*-survey-<date>`、`planned-rebuild-$DATE`；**每个包必须全新 BuildKit，无例外**；merge 后必须对 stable 重建再上传；stable 受保护禁止直推；`oma` 的 topics 子命令用于加入测试源 | 原文 |
| W-VERSION-SUFFIX | topic 版本后缀 | https://wiki.aosc.io/developer/packaging/topic-version-suffix/ | `$VER-$REL~pre<ISO8601 commit timestamp>`；dirty 树追加 `~dirty`；`~` 使 topic 包排序低于最终 stable 版本；topic 流水线只允许一次 REL bump | 原文 |
| W-BUILDIT | BuildIt! 使用 | https://wiki.aosc.io/developer/packaging/buildit-bot/ | `/login`、`/openpr <title>;<branch>;<pkgs>;<labels>;<arch>`、`/pr <PR_ID>`、`/build <branch> <pkg> <arch>`、`/status`、`/help`；包列表逗号分隔且为构建顺序；空字段省略规则（`;;amd64`）；PR 前必须 `git rebase stable`；merge 后重复 `/pr` 推 stable | 原文 |
| W-QA | QA issue 代码 | https://wiki.aosc.io/developer/packaging/qa-issue-codes/ | E=错误、W=警告；四类代码 E1xx/E2xx/E3xx/E4xx 的完整清单与描述（含 `E(W)302/322/323/324`） | 原文 |
| W-PVECTOR | p-vector | https://wiki.aosc.io/developer/infrastructure/p-vector/ | 子命令 `config.yaml (scan\|release [--force]\|sync\|analyze [full]\|reset [pv\|sync])`；`pv_packages`/`pv_package_issues` 等表结构；`level` 取 -1/0/1；101/102/103/301/302/303/311/321/322/323/324/401/402/411/412/421/431/432 的检测实现；E103 正则 `^[a-z0-9][a-z0-9+.-]*$` 与单字符例外；E432 递归规则与 `aosc-os-core` 豁免 | 原文 |
| W-CIEL | Ciel 手册 | https://wiki.aosc.io/developer/packaging/ciel-manual/ | Ciel 基于 OverlayFS + systemd-nspawn；内置命令 `init/drop/mount/merge/clean/shell/rawcmd`；插件位于 `/usr/libexec/ciel-plugin`，`ciel build` 即插件 | 原文 |
| W-QUIRKS | 常见故障 | https://wiki.aosc.io/developer/packaging/quirks/ | LTO 链接失败 → `NOLTO=1`；autotools 找不到 `install-sh`/已 configure → `ABSHADOW=0`；Rust 链接错误 → `USECLANG=1`；loongson3 的 `R_MIPS_64` → `USECLANG__LOONGSON3=0` + `NOLTO__LOONGSON3=1`；LoongArch 跨架构 `nspawn exited too early (exit code 127)` 与页大小限制 | 原文 |
| W-NEWPKG | 新包准入 | https://wiki.aosc.io/developer/packaging/new-package-guidelines/ | 新包的唯一标准：上游允许再分发；其他理由不作为接受或拒绝依据 | 原文 |
| W-REPO-META | 仓库元数据 | https://wiki.aosc.io/developer/packaging/repository-metadata-and-templates/ | `/usr/share/repository-data/` 的 `mirror.toml`、`comps.toml`、`template.toml`；用户覆盖目录 `/etc/repository-data/`；`mirror.toml` 默认 origin `https://repo.aosc.io/anthon/` | 原文 |
| W-MANIFEST | topic 更新清单 | https://wiki.aosc.io/developer/packaging/topic-update-manifest/ | topic 的用户可读更新说明（TOML），`security`、`must_match_all`、`[packages-v2]` 版本区间语法 | 原文 |
| W-INFRA | 基础设施索引 | https://wiki.aosc.io/developer/infrastructure/ | p-vector、Packages Site、Buildbots 等基础设施入口 | 原文 |
| G-ABBS | ABBS 主树 | https://github.com/AOSC-Dev/aosc-os-abbs | 主树地址；`git clone` 目标；类别目录结构；`groups/` 中大量 `*-rebuilds` 组与 `bootstrap-list.sh` | 原文 |
| G-BUILDKIT-WIKI | BuildKit 是什么 | https://github.com/AOSC-Dev/aosc-os-abbs/wiki/Preparing-What-is-BuildKit | BuildKit = 无内核的 base AOSC OS + 基本开发工具（含 Autobuild3、ABBS）；每个架构都有 BuildKit；非 amd64 自带 QEMU user 静态二进制 | 原文 |
| G-BUILDKIT-LST | BuildKit 配方 | https://raw.githubusercontent.com/AOSC-Dev/aoscbootstrap/master/recipes/mainline-buildkit.lst | BuildKit 由组构成：`acbs admin-base autobuild4 core-base debug-base devel-base editor-base git network-base python-base systemd-base util-base web-base` | 原文 |
| G-DEVEL-BASE | devel-base 元包 | https://raw.githubusercontent.com/AOSC-Dev/aosc-os-abbs/stable/meta-bases/devel-base/autobuild/defines | BuildKit 工具链确切清单：`binutils bison diffutils flex gawk gcc groff libtool m4 make patch pkg-config sed autoconf automake cmake gettext help2man texinfo meson ninja git`；`PKGPROV="build-essential base-devel"`；`VER_NONE=1` | 原文 |
| G-CORE | core-base 与 core 组 | https://raw.githubusercontent.com/AOSC-Dev/aosc-os-abbs/stable/meta-bases/core-base/autobuild/defines | `core-base` 依赖 `aosc-aaa bash gcc-runtime zlib`；`$VAR__$ARCH` 覆盖写法 `PKGDEP__RETRO`/`PKGDEP__ARMV4` 等；`ABSPLITDBG=0`、`FAIL_ARCH="!(mainline\|retro)"` | 原文 |
| G-CORE-GROUP | core 组文件 | https://raw.githubusercontent.com/AOSC-Dev/aosc-os-abbs/stable/groups/core | glibc、gcc 属于 core 组（`core-libs/glibc`、`core-devel/gcc`） | 原文 |
| S-SECTION | 规范 section 列表 | https://raw.githubusercontent.com/AOSC-Dev/autobuild4/master/sets/section | PKGSEC 的规范集合（utils、libs、devel、x11、Bases、non-free/…、contrib/…） | 原文 |
| G-CIEL | Ciel 3 源码 | https://github.com/AOSC-Dev/ciel-rs | Ciel 3 是 AOSC OS 的集成打包环境；systemd-nspawn + overlay；运行时依赖 systemd、D-Bus、OpenSSL、liblzma、libgit2；内核需 OverlayFS | 原文 |
| G-OMA | oma 源码 | https://github.com/AOSC-Dev/oma | `oma install/search/remove/refresh` 等命令参考；oma 负责 mirror 管理与 topic（测试）仓库加入 | 原文 |
| G-BOOTSTRAP | aoscbootstrap | https://github.com/AOSC-Dev/aoscbootstrap | `aoscbootstrap --branch --component --target --arch --config [--include] [--include-files] [--mirror]`；`--mirror` 缺省 `https://repo.aosc.io/debs`；`-1`、`-x`、`-s`、`--export-tar-xz/gz/squashfs`；依赖 liblzma/nettle/zlib/arch-chroot | 原文 |
| G-AB4 | Autobuild4 源码 | https://github.com/AOSC-Dev/autobuild4 | 仓库含 `sets/`（含 `section`）、`templates/`、`qa/`、`proc/`、`etc/`；`sets` 目录内容经 GitHub 目录页确认 | 原文 |
| S-OMA-TOPICS | oma 1.16 公告 | https://pastebin.anthonos.org/news/2025-04-12-oma-1.16-rc | `oma topics --opt-in <topic>` 用于加入测试源；`oma undo` 支持 topics 状态撤销 | 原文（公告） |
| S-OMA-TOPICS-ZH | 社区说明 | https://zhuanlan.zhihu.com/p/663808492 | `sudo oma topics` 交互式加入/退出测试源；可交叉印证子命令名 | 原文（社区文章，仅作交叉印证） |

## 2. 由多条原文推导出的结论（`[推断]`）

| 结论 | 推导依据 | 位置 |
| --- | --- | --- |
| 非 Linux 环境（macOS/Windows/无 nspawn 容器）只能生成配置与命令计划，不能真构建 | Ciel 被定义为 systemd-nspawn + OverlayFS（W-CIEL、G-CIEL），且 basics 明确要求“Linux 计算机并有 root 权限”（W-BASICS）；两者合起来意味着其他宿主无法执行 `ciel build` | SKILL.md §0、§15；workflow-commands.md 第 0 阶段 |
| 构建日志里出现 `BUILD SUCCESSFUL` 才算成功 | W-BASICS 原文描述为“If the build completes without error, and a BUILD SUCCESSFUL is present” | SKILL.md §9 |
| 新版 Ciel 把插件放在 `/usr/libexec/ciel-plugin`，因此 `ciel build` 的能力可被 `ciel-*` 扩展 | W-CIEL 原文描述插件机制；具体插件集合未逐一核对 | workflow-commands.md、SKILL.md §2 |
| 包目录名与 `PKGNAME` 通常一致 | W-BASICS 的 hello/i3 示例均为同名；原文未把一致性写成硬规则 | SKILL.md §4 |
| `oma refresh && oma upgrade` 是启用 topic 后更新系统的合理步骤 | G-OMA 命令参考（`refresh` 在 `install`/`upgrade` 前自动执行）+ W-TOPIC 的 topic 测试流程 | workflow-commands.md 第 8 阶段 |
| `p-vector release --force` 会覆盖常规安全检查 | W-PVECTOR 的用法行只列出 `release [--force]`，未解释语义；正文因此只陈述“接受 `--force`”，不描述其效果 | SKILL.md §13、workflow-commands.md 第 10 阶段 |
| 用 `dpkg -c` / `dpkg -I` 检查产物，对应 E3xx 的检查项 | W-QA 的 E3xx 描述（路径、权限、owner、size）对应 deb 内部信息；W-PVECTOR 的检测表逐条给出判据 | workflow-commands.md 第 4 阶段 |

## 3. 未找到权威来源、故未写入正文的结论（`[UNVERIFIED]`）

| 结论 | 情况 |
| --- | --- |
| `pakfixer` 的独立仓库与用法 | W-BASICS 仅一句“commit 前可以用 pakfixer 检查构建脚本”。`github.com/AOSC-Dev/pakfixer` 的 README 抓取返回 404，仓库地址与参数未核实。SKILL.md 只写了 `pakfixer` 这个命令名，未写任何参数。 |
| `abbs-update-checksum` 的实现来源 | 命令名与用法出自 W-STYLING（`abbs-update-checksum $PKGNAME`）。脚本所在仓库未核实（`AOSC-Dev/abbs` 的 `scripts/` 路径 404）。 |
| `/dickens` 审计命令 | W-BASICS 提到 “generate audit reports (/dickens)”，但 W-BUILDIT 的命令清单里没有它，参数与语义完全未记录，因此 SKILL.md 与 references 均未采用。 |
| `cargo` 作为 ABTYPE | 契约中的 lint 已知集合含 `cargo`，但 W-AB3、W-ADV 均以 `rust` 描述 Cargo 源码树，没有页面列出 `cargo`。技能文件按原文写 `rust`，未声称存在 `cargo` 模板。 |
| `E302`/`E322`/`E323`/`E324` 的严格严重级别 | W-QA 写作 `E(W)`，含义是随情形在错误与警告间取值；具体判定阈值只有 W-PVECTOR 的检测条件（10 MB/中位数三分之一、uid/gid>999 等），未给出“何时升级为 error”的规则。 |
| `W111`/`W112`/`W113`/`W121`/`W122`/`W123` 与 `E104`/`E202`/`E211`/`E221`/`E325`/`W331` 的自动检测实现 | W-QA 给出定义，W-PVECTOR 的 Analyze 一节没有列这些代码的检测语句。正文只写定义与修复方向，未编造检测逻辑。 |
| `Haskell`/`plainmake` 的当前检测顺序 | 只在 W-AB3 出现（老版 Autobuild3 手册）；W-ADV 的新列表未列它们。技能文件按“并集”描述并注明来源差异。 |
| LoongArch 之外其他架构的跨架构可用性 | W-QUIRKS 只说明了页大小限制这一通用原因；未对其他架构逐一核实。 |

## 4. 抓取与校验记录

- 抓取日期：2026-11-13。
- 站点页面用 `curl -sSL` 取 HTML 后转纯文本阅读；GitHub 文件用 `raw.githubusercontent.com` 直取原文；GitHub REST API 在批量列举目录时触发限流（`API rate limit exceeded`），因此目录级信息改用仓库 HTML 页面与 raw 文件路径核对。
- 所有 `https://wiki.aosc.io/...` 页面均返回 HTTP 200；`aosc-os-abbs` 的 `groups/buildkit`、`.buildkit`、`devel-base` 等猜测路径返回 404，因此 BuildKit 清单最终以 `meta-bases/devel-base/autobuild/defines` 与 `aoscbootstrap` 的 `recipes/mainline-buildkit.lst` 为准。
