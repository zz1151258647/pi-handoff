# pi-handoff

当前版本：**v2.0.0**（原名 pi-project-handoff）。本版从自动交接提醒改为纯手动命令，与 1.x 的提醒机制不兼容；升级后请执行 `/reload` 或重启 Pi。

用于 **Pi coding agent** 的纯手动任务交接插件。只在执行 `/handoff` 时整理保存，执行 `/handoff 接续` 时自动读取。材料在插件专属缓存，不写业务项目，不必添加 `.gitignore`。

## 使用

| 命令 | 效果 |
| --- | --- |
| `/handoff` | 整理目标、决定、真实进度、证据和下一步，保存到缓存 |
| `/handoff 保存 <补充要求>` | 带要求整理保存；`交接` 为别名 |
| `/handoff 接续` | 读取单份存档，核对成功后清理，再继续已授权事项；`恢复` 为别名 |
| `/handoff 状态` | 显示压缩次数与实际存档路径，不调用模型 |
| `/handoff 检查` | 兼容旧命令，仅显示状态，不再评估交接 |

接续只需：开启新 Pi 会话，输入 `/handoff 接续`。不需要填写路径或粘贴长提示词。插件不自动新建或切换会话；普通启动也不会加载存档。

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

```bash
pi install git:github.com/zz1151258647/pi-handoff
```

从旧名称升级：将安装来源改为 `git:github.com/zz1151258647/pi-handoff`，避免新旧来源同时安装。缓存位置保持不变。

安装或修改后执行 `/reload` 或重启 Pi。`/handoff 状态` 可确认命令已加载。

手动安装需复制 `extensions/handoff.ts` 到 `<agent-dir>/extensions/`，并复制 `skills/handoff/` 到 `<agent-dir>/skills/`；必须同时安装扩展与 Skill。

## 测试

```bash
node tests/simulate.test.js
```

在独立临时目录模拟命令、压缩、存档、恢复与渲染，不联网、不调模型。自动寻找 Pi 安装依赖，也可用 `PI_NODE_MODULES` 指定。模拟通过不等于真实 TUI 已验收：重载后执行一次 `/compact` 检查灰色提示，再测试保存与新会话接续。

## 卸载

```bash
pi remove git:github.com/zz1151258647/pi-handoff
```

缓存保留，可自行备份或删除 `<agent-dir>/cache/project-handoff/`。旧版 `<agent-dir>/state/project-handoff/` 也不会自动清理。

## 致谢与许可

交接材料规范移植自 [duoduoler-ops/Table-skills](https://github.com/duoduoler-ops/Table-skills) 的 project-handoff，现已改为 Pi 原生手动命令与缓存流程。MIT，见 [LICENSE](LICENSE)。
