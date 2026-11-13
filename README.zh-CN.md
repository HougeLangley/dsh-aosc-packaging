# dsh-aosc-packaging

[![CI](https://github.com/HougeLangley/dsh-aosc-packaging/actions/workflows/ci.yml/badge.svg)](https://github.com/HougeLangley/dsh-aosc-packaging/actions/workflows/ci.yml)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 AOSC OS 打包工具箱：六个 Host 工具负责检查、lint、脚手架与规划 ABBS / Autobuild4 包，外加一个自带 `aosc-packaging` 技能，覆盖从 topic 到发布的全流程。

AOSC OS 用 Autobuild4、Ciel 与 BuildKit 从 [ABBS 树](https://github.com/AOSC-Dev/aosc-os-abbs)构建 `.deb` 包，流程散落在多份手册里。本插件把同一份地图收进一个技能，并用确定性工具兜底：agent 可以读取包、指出样式规则会拒绝什么、生成脚手架、计算源码校验和，并起草分支名、提交信息、PR 正文与 BuildIt! 命令，而不是靠猜。

这里没有任何东西会启动 shell。五个工具不写磁盘；`aosc_checksum_source` 是唯一联网的工具，`aosc_scaffold_package` 是唯一写文件的工具——只在你指定的 tree 内写两个文件。真正构建出包仍然需要 Linux、root 与 Ciel。

## 环境要求

| 要求 | 说明 |
| --- | --- |
| Node.js | 22 或更新。仅 ESM，无构建步骤，无运行时依赖。 |
| Host | 能通过 `dsh.bundle` manifest 加载 bundle 的 dsh 版本。 |
| 客户端系统 | 六个工具在 macOS、Windows、Linux 上都能运行。 |
| 真实构建 | Linux + root + Ciel + 至少 10 GiB 空闲磁盘。 |

`aosc_build_plan` 只输出命令，从不执行 Ciel、Git 或 BuildIt!。在 macOS 与 Windows 上，工具仍可完成 inspect、lint、scaffold、checksum 与 plan；构建本身则需要装好 Ciel 的 Linux 主机，这是 AOSC OS 手册的要求。

## 安装

### 从 GitHub 安装

```sh
dsh plugin --profile desktop add github:HougeLangley/dsh-aosc-packaging
```

如果你想把插件装进别的 profile，把 `desktop` 换成对应名字。

### 从本地目录安装

```sh
git clone https://github.com/HougeLangley/dsh-aosc-packaging.git
cd dsh-aosc-packaging
dsh plugin --profile desktop add "$PWD"
```

### 从 Plugins 页面添加本地目录

打开 dsh 桌面端的 **Plugins** 页面，开始添加插件时选择本地目录，指向仓库 checkout 而不是包名。本地目录从磁盘读取，不经过包注册表。

插件的 `dsh.bundle` manifest 指向 `cordis.patch.yml`，其中插入一条 `dsh-aosc-packaging` 条目。激活时注册六个工具；Host 提供技能服务时再注册 `aosc-packaging` 技能。技能文件读取失败只会记录警告，工具照常工作，激活不会因此失败。

## 工具

| 工具 | 作用 | 是否联网 | 是否写文件 |
| --- | --- | --- | --- |
| `aosc_inspect_package` | 解析 `spec` 与 `autobuild/defines`，报告 `autobuild/` 下哪些可选文件存在，并附带 lint 结果 | 否 | 否 |
| `aosc_lint_package` | 对包目录运行包规则与提交信息规则的静态检查 | 否 | 否 |
| `aosc_scaffold_package` | 先校验输入，再向 `<treeRoot>/<pkgname>` 写入 `spec` 与 `autobuild/defines`，并对结果执行 lint | 否 | 是——仅该包目录 |
| `aosc_checksum_source` | 以流式方式对每个源码 URL 计算 SHA-256 / SHA-512 / SHA-1，返回可直接写入 `CHKSUMS=` 的字符串 | 是——你传入的 URL | 否，不落盘 |
| `aosc_topic_plan` | 为一个 topic 起草分支名、提交标题与正文、PR 标题与正文、BuildIt! 命令与检查清单 | 否 | 否 |
| `aosc_build_plan` | 返回按顺序排列的 `ciel` / `git` / `oma` / `p-vector` 命令计划，含前置条件与说明 | 否 | 否 |

### `aosc_inspect_package`

入参：`{ path }`。结果包含解析后的绝对路径、`layout` 对象（`spec`、`defines`、`prepare`、`patch`、`build`、`beyond`、`pax`、patch 数量、override 数量）、解析后的 `spec` 与 `defines` 结构，以及和 linter 相同的 issue 列表。可选文件缺失时返回空结构，只有包路径不存在才抛错。

### `aosc_lint_package`

入参：`{ path, commitMessage?, strict? }`。检查范围覆盖包身份与目录布局（`E101`–`E104`）、`spec` 源码与校验和（`L001`–`L007`）、描述风格（`L008`、`L009`）、`ABTYPE` 与构建文件（`L010`–`L013`、`L017`、`L018`）、patch 命名（`L014`）、`autobuild/*` 脚本中的 shell 变量引用（`L015`）、指向 `/usr/local` 的 override（`L016`）、`PKGDEP` 为空的信息级提示（`L019`），以及 topic 提交格式（`W121`、`W122`）。没有 error 时 `ok` 为真；`strict` 模式下还要求没有 warning。它完全离线：规范 `PKGSEC` 列表是内置快照。

### `aosc_scaffold_package`

入参：`{ treeRoot, pkgname, ver, section, description, sources, abtype, depends, buildDepends, recommends, noarch, rel, epoch, overwrite }`。写盘前先校验输入；目标包目录已存在且 `overwrite` 不为 `true` 时拒绝执行。返回两个生成文件的完整文本与 lint 结果，并明确警告 `CHKSUMS="SKIP"` 只是占位、等待真实摘要。源码 URL 里的 `$VER` 会原样保留进 `spec`。

### `aosc_checksum_source`

入参：`{ urls, algorithm?, timeoutMs? }`，默认 `sha256` 与 20000 ms。跟随重定向，以流式读取响应并计算哈希，非 2xx 直接报错，单个源码超过 256 MiB 会以明确错误中止。文件不会写入磁盘；结果同时给出重定向后的最终 URL。

### `aosc_topic_plan`

入参：`{ packages, kind, version, purpose, summary, canonicalPkg, date, labels, arch }`。`kind` 取 `new`、`update`、`security`、`change`、`rebuild`、`drop` 之一，`packages` 按构建顺序排列。结果包含 `branch`、`commitMessage`、`commitBody`、`prTitle`、`prBody`、`builditCommands`（`openpr`、`pr`、`build`）、`warnings` 与 `checklist`。分支与提交命名遵循 AOSC topic 与样式手册；多包 topic 缺少 `canonicalPkg` 时会给出警告。

### `aosc_build_plan`

入参：`{ packages, instance?, arch?, topic?, workspace? }`。阶段覆盖环境准备、检出树与 topic 分支、`ciel build`、检查 `.deb`、安装与测试、通过 BuildIt! 提交并开 PR、合并后必须执行的 stable 重建，以及 p-vector 仓库发布。每条命令都可直接复制，并附带用途说明；notes 会重申 Linux / root / 10 GiB 要求、每个包一次干净的 BuildKit，以及 stable 重建不可省略。

## 技能：`aosc-packaging`

本插件注册一个技能：`aosc-packaging`。当任务涉及以下内容时使用它：AOSC OS 发布模型与 ABBS 树、`spec` 或 `autobuild/defines`、Autobuild4 的 `ABTYPE` 选择、`ciel` / BuildKit / `oma`、topic 分支与 PR 约定、BuildIt! 机器人命令、p-vector 发布，或者要在推送前审查一个 `.deb`。

技能内容包括：AOSC OS 是什么、滚动发布与 topic 如何运作；工具链地图（ABBS、ACBS、Autobuild4、Ciel/BuildKit、oma、BuildIt!、p-vector、aoscbootstrap）；环境搭建；包结构；`spec` 变量与版本归一化；`defines` 变量与直接 ELF 依赖规则；如何选择 `ABTYPE`；打包策略与文件落位；构建循环；topic 工作流；提交信息表；BuildIt! 命令；p-vector 发布与 QA issue 代码分类；镜像与 ISO 发布；每个打包步骤对应哪个工具；以及 FTBFS、依赖与校验和失败的排查路径。

技能内部以相对路径链接自己的参考文档（`spec-reference.md`、`defines-reference.md`、`workflow-commands.md`、`qa-codes.md`），每个非显然结论在 `docs/SOURCES.md` 里都有来源 URL。

## 示例提示词

1. `检查 ~/abbs/nano，告诉我提交前哪些 lint 错误会阻塞这个 topic。`
2. `在 ~/abbs 里为 hello 2.12.1 生成新包脚手架，源码用 https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz，然后校验这个 URL 并给我可以粘贴的 CHKSUMS 行。`
3. `规划 nano 7.2 的 build-fix topic：分支名、提交信息、PR 正文，以及 BuildIt! 的 /openpr 命令。`

三条提示词分别对应：第一条走 `aosc_inspect_package` 与 `aosc_lint_package`；第二条走 `aosc_scaffold_package` 加 `aosc_checksum_source`；第三条走 `aosc_topic_plan`。需要完整 Ciel 命令序列时再加 `aosc_build_plan`。

## 安全说明

- **不执行 shell。** 任何工具都不会启动 `ciel`、`git`、`oma`、`p-vector` 或 shell。命令只以字符串返回，是否执行由你决定。
- **唯一的联网路径。** `aosc_checksum_source` 只对你传入的 URL 发起 HTTP(S) GET，跟随重定向，遵守超时（默认 20 秒）与调用方的中止信号，单个源码上限 256 MiB。校验和在流上计算，不保存文件。
- **唯一的写入路径。** `aosc_scaffold_package` 只在 `<treeRoot>/<pkgname>` 下创建 `spec` 与 `autobuild/defines`，不碰其他位置；目录已存在且未设 `overwrite: true` 时拒绝覆盖。
- **默认只读。** inspect、lint、topic 规划与构建规划既不写文件也不联网。lint 使用内置 `PKGSEC` 快照，不做实时下载。

## 范围与边界

- 没有 UI、没有设置页、没有客户端面板；本插件只有 Host 工具与一个技能。
- 不构建包、不运行 Ciel、不自动开 PR、不向 ABBS 发布。这些步骤要么由你手动完成，要么属于 BuildIt!。
- 它不是包管理器，不安装任何 AOSC OS 软件。
- 规划输出以 AOSC OS 手册为准；手册变化时，技能里的 `docs/SOURCES.md` 是重新核对来源的线索。

## 目录结构

```
dsh-aosc-packaging/
├── package.json                     # bundle manifest、exports、scripts
├── cordis.patch.yml                 # loader 入口
├── lib/
│   ├── index.js                     # 插件入口：六个工具 + 技能注册
│   ├── parse.js                     # spec / defines 解析
│   ├── lint.js                      # 静态规则
│   ├── scaffold.js                  # spec + defines 生成
│   ├── checksum.js                  # 流式源码哈希
│   ├── topic.js                     # topic / PR / BuildIt! 规划
│   └── buildplan.js                 # Ciel 构建计划
├── skills/aosc-packaging/
│   ├── SKILL.md                     # 打包方法论
│   └── references/                  # spec、defines、命令、QA 代码
├── docs/
│   ├── SOURCES.md                   # 每个结论的来源 URL
│   ├── DETAIL.md                    # 唯一一张特性图
│   ├── preview.svg                  # 640×300 流水线插图
│   └── MARKETPLACE.md               # 目录条目与 PR 步骤
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

## 开发与测试

没有安装步骤，也没有依赖：源码在 Node.js 22 及以上直接运行。

```sh
npm test                     # node --test tests/
node --check lib/index.js    # 单文件语法检查
```

插件入口是 `lib/index.js`，`package.json` 同时把它导出为主入口与 `.`。技能是纯 Markdown，激活时从磁盘读取，改完不需要重新构建。

## 市场上架

本插件计划进入 dsh 插件市场。可直接提交的目录条目、`awesome-dsh-plugin/awesome-dsh-plugin` 的投稿文件、PR 步骤与 Discover 索引说明都在 [docs/MARKETPLACE.md](docs/MARKETPLACE.md)。0.1.0 状态：尚未上架。

## 许可证

MIT © 2026 HougeLangley。见 [LICENSE](LICENSE)。
