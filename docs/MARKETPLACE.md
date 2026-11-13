# Marketplace submission

Status: **not submitted yet.** Nothing in this repository claims that `dsh-aosc-packaging` is already listed or indexed.

The target is [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), the curated dsh plugin list whose category **Tools & Capabilities** is the right home for a Host-tool bundle. The list doubles as a plugin market index; see [Discover index](#discover-index) below.

## Catalog entry

This is the line the list renders for this bundle:

```
- [HougeLangley/dsh-aosc-packaging](https://github.com/HougeLangley/dsh-aosc-packaging) - Research-backed AOSC OS packaging toolkit for DeepSeek Harness: six Host tools inspect and lint ABBS packages, scaffold spec and autobuild/defines inside an ABBS tree, checksum source URLs over the network, and plan topics and Ciel builds, plus a bundled aosc-packaging skill; no tool runs a shell, and producing the .deb still needs Linux with root and Ciel.
```

## Submission file

The list is generated: both READMEs are rendered from `data/plugins/*.yml`, and the [contributing guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) asks contributors not to edit the READMEs by hand. A submission is one new file, `data/plugins/HougeLangley__dsh-aosc-packaging.yml`:

```yaml
url: https://github.com/HougeLangley/dsh-aosc-packaging
name: HougeLangley/dsh-aosc-packaging
category: tools
description:
  en: 'Research-backed AOSC OS packaging toolkit for DeepSeek Harness: six Host tools inspect and lint ABBS packages, scaffold spec and autobuild/defines inside an ABBS tree, checksum source URLs over the network, and plan topics and Ciel builds, plus a bundled aosc-packaging skill; no tool runs a shell, and producing the .deb still needs Linux with root and Ciel.'
  zh: '面向 DeepSeek Harness 的 AOSC OS 打包工具箱：六个 Host 工具读取并检查 ABBS 包、在指定 tree 内生成 spec 与 autobuild/defines 脚手架、联网校验源码 URL、起草 topic 与 Ciel 构建计划，并自带 aosc-packaging 技能；任何工具都不启动 shell，真正产出 .deb 仍需要 Linux 主机、root 与 Ciel。'
```

Notes on the format:

- `category: tools` is the data value that renders under **Tools & Capabilities**.
- `description.en` contains `: `, so it must stay quoted — an unquoted YAML value with a colon-space breaks the parser.
- `zh` is optional in the list (maintainers fill missing translations), but both are supplied here so the entry is complete in both READMEs.
- The optional `icon:` field expects a GitHub-hosted raster image for the storefront tile. This bundle ships only `icon.svg`, so the entry omits `icon:` and falls back to the owner avatar, or an `assets/icon-180.png` can be added later.
- One PR may add at most 3 entries; this submission adds one.

## Submission steps

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin` to your own account.
2. Create a branch named `add-dsh-aosc-packaging` from `main`.
3. Add `data/plugins/HougeLangley__dsh-aosc-packaging.yml` with the content above. Do not edit `README.md` or `README.zh.md`; they are generated from the data files.
4. Commit (for example `Add dsh-aosc-packaging`) and push the branch to your fork.
5. Open a pull request against `awesome-dsh-plugin/awesome-dsh-plugin:main`. Use the title and body templates below.
6. Wait for review. A maintainer reads the plugin source and checks every claim in the description against it; an inaccurate description is sent back as a PR comment, not rejected outright.
7. If the PR gets a `held: author` label, push the fixes to the same branch and leave one comment describing what changed. Repeat pushes do not speed up re-review.
8. After merge, both READMEs regenerate on `main` and the line appears under **Tools & Capabilities**. That is the whole submission; there is nothing else to publish.

Older copies of the list were edited by hand. If a maintainer asks for the rendered line instead of the data file, it is the catalog entry above, inserted under `### Tools & Capabilities` and ordered with the existing entries.

### PR title

```
Add dsh-aosc-packaging (AOSC OS packaging tools)
```

### PR body

```markdown
### Plugin

- Repository: https://github.com/HougeLangley/dsh-aosc-packaging
- Category: Tools & Capabilities (`tools`)
- One line: six Host tools for AOSC OS packaging (inspect, lint, scaffold, checksum, topic plan, Ciel build plan) plus a bundled `aosc-packaging` skill.

### Checklist

- [ ] `package.json` declares `dsh.bundle` with `./cordis.patch.yml`
- [ ] Installs with `dsh plugin --profile desktop add github:HougeLangley/dsh-aosc-packaging`
- [ ] README documents installation, the six tools and the skill
- [ ] Every claim in this description is implemented: no UI, no shell execution, no automatic build, no automatic PR
- [ ] Repository is public and at least one day old
- [ ] One entry in this PR
```

## Discover index

On dsh 0.2.1 and newer, the list is also a plugin market index: open **Plugins → Discover → Index sources** and add

```
https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
```

The same document is published at `https://awesome-dsh-plugin.com/index.json` and mirrored at `https://dshmarket.com/index.json`. The list recommends the jsDelivr URL because dsh gives an index source 15 seconds and the GitHub Pages copies can exceed that from some networks.

Two consequences for this bundle:

- The index covers plugins published on npm with a known version. At 0.1.0 this bundle is distributed from GitHub, so expect the list entry to install through the `github:` command shown beside it; Discover search coverage requires an npm release with a known version.
- Being merged into the list is not the same as being indexed in Discover. Do not claim either until both have happened.

## Pre-listing checklist

- [ ] Repository is public at `https://github.com/HougeLangley/dsh-aosc-packaging`
- [ ] `package.json` declares the `dsh.bundle` manifest pointing at `./cordis.patch.yml`
- [ ] `dsh plugin --profile desktop add github:HougeLangley/dsh-aosc-packaging` installs the bundle
- [ ] README.md and README.zh-CN.md both contain an Install section with the three documented paths
- [ ] Every advertised capability exists: six Host tools and one `aosc-packaging` skill, nothing else
- [ ] No UI, settings page, shell execution, automatic build, automatic PR or ABBS publishing is claimed
- [ ] `locale/en.json` and `locale/zh.json` parse and describe the same six tools, the skill, the read-only/network boundary and the Linux build requirement
- [ ] `docs/DETAIL.md` is one image line and `docs/preview.svg` is a self-contained 640×300 illustration
- [ ] `LICENSE` is MIT and `CHANGELOG.md` records 0.1.0
- [ ] Repository is at least one day old (a list requirement)
- [ ] One PR, one entry; split any additional entries into their own PRs
- [ ] Nothing in the submission says the bundle is already listed, indexed or reviewed
