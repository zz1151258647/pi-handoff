# pi-handoff

当前版本：**v2.0.1**（原名 pi-project-handoff）。本版增加预编译 JS 运行包分发，不改变 v2.0.0 的手动交接行为。2.x 与 1.x 的自动提醒机制不兼容；升级后请执行 `/reload` 或重启 Pi。

用于 **Pi coding agent** 的纯手动任务交接插件。只在执行 `/handoff` 时整理保存，执行 `/handoff 接续` 时自动读取。材料在插件专属缓存，不写业务项目，不必添加 `.gitignore`。

## 使用

| 命令 | 效果 |
| --- | --- |
| `/handoff` | 整理目标、决定、真实进度、证据和下一步，保存到缓存 |
| `/handoff 交接 <补充要求>` | 带要求整理并保存当前进度 |
| `/handoff 接续` | 读取单份存档，核对成功后清理，再继续已授权事项 |

菜单只展示「交接、接续」。旧输入 `保存`、`恢复`、`状态`、`检查` 仍兼容，但不再列入菜单；其中状态与检查仅显示压缩次数和路径，不调用模型。

接续只需：开启新 Pi 会话，输入 `/handoff 接续`。不需要填写路径或粘贴长提示词。插件不自动新建或切换会话；普通启动也不会加载存档。

- 输入 `/handoff` 或部分命令名 `/hand` 后，按 Tab 补全为 `/handoff `，立即显示「交接、接续」两项子菜单，无需再手动按空格。上下键选择、Tab 填入，Enter 选择参数后还需再次 Enter 才执行；Esc 取消菜单。手动输入 `/handoff `、中文前缀筛选、子命令后的自由补充要求仍可用。
- 保存和接续的程序生成消息仅显示简短提示，不再把整段提示词、JSON 交接正文铺满会话。完整材料和用户补充要求仍保留在模型上下文与会话记录中；只是缩短界面显示，不代表材料被截断或已经接手成功。

### 压缩完成提示

每次成功压缩后，消息流中显示一行灰色（主题 dim 色）提示：

> 当前会话已压缩 3 次

纯计数，不唤起模型、不注入提示词、不评估交接、不主动提醒。手动和自动成功压缩均计入；失败和取消不计。计数来自活动分支的真实压缩历史，重启或 `/reload` 不清零，派生会话包含继承的历史。终端字号保持正常，仅弱化颜色。

### 缓存位置

```text
~/.pi/agent/cache/project-handoff/handoff.md
```

- 设置 `PI_CODING_AGENT_DIR` 时，使用该目录下的 `cache/project-handoff/`。
- 全部项目和会话共用这一份临时交接材料，不做项目区分；每次手动保存覆盖旧内容，不混入旧任务。接续核对成功后清理；读取失败、核对阻塞或取消时保留，其他会话更新的新存档不会被误删。
- 实际任务目录保存在材料中，接续时先核对，避免在新会话的其他目录误改。更换机器需要自行迁移。
- 缓存放在插件专属的用户数据目录，而非插件源码仓库，避免更新、重装和切换版本覆盖存档。
- 写入由仅对本次命令授权的 `handoff_save` 工具完成，采用临时文件替换、并发锁及回读核验；不改业务项目文件。
- 下次 `/handoff 交接` 从当前会话从零生成，不增量修改或合并旧档。不是历史档案库；如需保留交接材料，请在接续前自行备份。

旧版的阶段提醒、压缩/规模检查点、冷却、`handoff_state` 及自动补漏已移除；`PI_HANDOFF_SIZE_THRESHOLD` 不再使用。自然语言提到交接不会自动保存；请使用命令。原有 `PROJECT_STATE.md` 与旧计数 JSON 不自动迁移或删除。如需导入旧材料，可执行 `/handoff 保存 请读取并导入 <旧文件路径>`。

## 安装

### 预编译运行包（推荐）

需要已安装的 Pi 和 Node.js >=22.13；宿主提供 Pi SDK 与 `typebox`，**不要在运行包内执行 `npm install`**。运行包为 ESM JavaScript，无 TS 源码、构建依赖、用户设置或交接缓存。SHA256 只能检查完整性，请从可信的 Release 页面同时取得压缩包与清单。

试用前请备份现有设置并暂停旧 pi-handoff 来源（含手工复制的扩展/Skill），避免 `pi -e` 额外加载时与旧版重复注册；保留旧版本文件供回退。

PowerShell 下载并校验（任一下载或校验失败都应停止）：

```powershell
$base = 'https://github.com/zz1151258647/pi-handoff/releases/download/v2.0.1'
Invoke-WebRequest "$base/pi-handoff-2.0.1.tgz" -OutFile pi-handoff-2.0.1.tgz -ErrorAction Stop
Invoke-WebRequest "$base/SHA256SUMS.txt" -OutFile SHA256SUMS.txt -ErrorAction Stop
$expected = ((Get-Content SHA256SUMS.txt -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash pi-handoff-2.0.1.tgz -Algorithm SHA256).Hash
if ($expected -notmatch '^[0-9a-fA-F]{64}$' -or $actual -ne $expected) { throw 'SHA256 校验失败，停止安装' }
New-Item -ItemType Directory unpacked -ErrorAction Stop | Out-Null
tar -xzf pi-handoff-2.0.1.tgz -C unpacked
if ($LASTEXITCODE -ne 0) { throw '解包失败，停止安装' }
$dest = Join-Path $HOME '.pi/agent/local-packages/pi-handoff/2.0.1'
node ./unpacked/package/install.mjs --dest "$dest"
if ($LASTEXITCODE -ne 0) { throw '复制失败，停止加载' }
# 仅本次启动试用，不写设置，同时加载扩展与 Skill：
pi -e "$dest"
```

通用 shell（Linux；macOS 可将 `sha256sum -c` 换为 `shasum -a 256 -c`）：

```bash
base='https://github.com/zz1151258647/pi-handoff/releases/download/v2.0.1'
curl -fL "$base/pi-handoff-2.0.1.tgz" -o pi-handoff-2.0.1.tgz &&
curl -fL "$base/SHA256SUMS.txt" -o SHA256SUMS.txt &&
sha256sum -c SHA256SUMS.txt &&
mkdir unpacked &&
tar -xzf pi-handoff-2.0.1.tgz -C unpacked &&
node unpacked/package/install.mjs --dest "$HOME/.pi/agent/local-packages/pi-handoff/2.0.1" &&
pi -e "$HOME/.pi/agent/local-packages/pi-handoff/2.0.1"
```

`unpacked` 应为全新目录。安装器只复制 9 个白名单文件，目标必须不存在或为空；拒绝非空目录、与运行包重叠的目录及符号链接/目录联接。不自动安装依赖、不修改 settings 或交接缓存。也可直接将解包后的 `package/` 移到固定版本目录；**不要只加载 JS 文件而遗漏 Skill**。

确认试用正常后，可手动将下面的本地目录条目合并到 `<agent-dir>/settings.json` 的 `packages` 数组（保留其他设置；将路径替换成自己的绝对路径，Windows JSON 使用 `/` 或转义 `\\`）：

```json
{
  "packages": ["/your/absolute/path/pi-handoff/2.0.1"]
}
```

切换前记录旧来源/固定版本目录。移除或禁用旧 pi-handoff 来源及手工复制的旧扩展/Skill，避免双重加载，再 `/reload` 或重启。`/handoff 状态` 仅显示状态，不调用模型；确认菜单可用后再按需要测试交接。

**回退：** 将同一 `packages` 条目改回保留的旧版本固定目录或原来源，移除新条目后重载/重启；不要同时加载两版。不覆盖旧版本目录，不删除或迁移交接缓存。原来使用 Git 来源时应保留其固定 tag/提交，避免回退到浮动分支。

### 源码安装与开发

源码仓库的 manifest 仍指向 `extensions/handoff.ts`；Git 安装/本地开发由 Pi 加载 TS，与 Release 中仅含 JS 的运行包不同。

```bash
pi install git:github.com/zz1151258647/pi-handoff@v2.0.1
# 本地源码试用（在仓库目录）：
pi -e .
```

从旧名称升级时改用 pi-handoff 来源，不要保留新旧来源同时安装。安装或修改后执行 `/reload` 或重启 Pi。手动复制源码时，必须同时复制 `extensions/handoff.ts` 与完整的 `skills/handoff/`。

本版维护与验收记录：[v2.0.1 版本入口](https://github.com/zz1151258647/pi-handoff/tree/v2.0.1/docs/handoff/versions/v2.0.1)。

## 构建与测试

构建需 Node.js >=22.13（内置 `node:module.stripTypeScriptTypes`）和本机 npm，无需新增依赖或 lock；不联网、不调用模型、不自动安装 peers。默认生成 `dist/pi-handoff-2.0.1.tgz` 与 `dist/SHA256SUMS.txt`，也可将输出指定为源码外的临时目录（仓库内部仅允许 `dist/`）。同名产物/清单会被替换，其他文件不动。

```bash
npm run build
npm run build -- --out-dir /your/temporary/output
npm test
npm run test:artifact
# 也可对指定解包后的运行入口回归：
node tests/simulate.test.js /your/unpacked/package/extensions/handoff.js
```

运行包严格包含：`extensions/handoff.js`、完整 `skills/handoff/`（4 文件）、运行 `package.json`、`README.md`、`LICENSE`、`install.mjs`。不含 TS、Git、tests、版本材料、node_modules、缓存或凭据；运行 manifest 指向 JS，宿主依赖仅声明为 `peerDependencies: "*"`。新增 Skill 资源须显式更新 `scripts/install.mjs` 的白名单及产物测试名单。

`test:artifact` 在临时目录离线构建、核对 SHA256 与 tar 白名单、版本及 manifest，验证包内 Skill 正文和链接，执行源码和产物各 15 组回归，并检查安全安装、拒绝非空/重叠/链接目录以及源码未变。安装脚本不切换配置；远端发布和本机加载来源切换需另行执行。

在独立临时目录模拟命令、压缩、存档、恢复与渲染，不联网、不调模型；使用真实 Pi 加载器、编辑器和消息组件回归子命令补全、上下键选择、Tab 填入及长材料的简短显示，并检查模型上下文保留原文。自动寻找 Pi 安装依赖，也可用 `PI_NODE_MODULES` 指定。另覆盖 `/hand`、`/handoff` → Tab → 两项子菜单的完整按键路径、Esc 取消后再次 Tab、既有自定义编辑器组合及其他补全委托。自动测试通过不等于当前终端已人工验收：重载后按上述完整路径检查子菜单，再测试保存与新会话接续。

## 卸载

本地运行包：从设置中移除对应固定目录条目，重载/重启后再按需删除版本目录；安装器不会自动修改设置。

Git 来源：

```bash
pi remove git:github.com/zz1151258647/pi-handoff
```

缓存保留，可自行备份或删除 `<agent-dir>/cache/project-handoff/`。旧版 `<agent-dir>/state/project-handoff/` 也不会自动清理。

## 致谢与许可

交接材料规范移植自 [duoduoler-ops/Table-skills](https://github.com/duoduoler-ops/Table-skills) 的 project-handoff，现已改为 Pi 原生手动命令与缓存流程。MIT，见 [LICENSE](LICENSE)。
