# 01 运行包分发 · 源码调研

> 关联事项：[Plan 01](../../plan.md)
> 调研状态：源码、构建和当前宿主兼容性已核实
> 基线：dbc1c7e，2026-11-03

## 要核实的问题

源码开发入口与正式安装解耦后，运行包是否能保留现有行为、完整 Skill 和宿主依赖映射。

## 已核实的源码事实

| 环节 | 当前实际行为 | 证据 |
|---|---|---|
| 包发现 | 根 package.json 声明 extensions/handoff.ts 和 skills/handoff；只有宿主 peerDependencies | 根 package.json |
| 运行行为 | 两项子菜单、Tab 连续补全和用户消息简短显示已在 dbc1c7e 实现 | extensions/handoff.ts、tests/simulate.test.js 的 15 组回归 |
| 依赖边界 | Pi 文档要求 SDK/typebox 作为宿主 peers，不捆绑物理副本；支持 TS/JS 入口 | Pi docs/packages.md、docs/extensions.md |
| 存储 | handoff.md 位于用户 agent 数据目录 cache/project-handoff，不在源码或安装包 | extensions/handoff.ts 的 cachePath |
| 分发 | v2.0.0 Release 存在，assets 为空，只有自动源码归档 | GitHub Release API 只读核对 |
| 工作区 | 原仓库有未跟踪 .pi/ 和 package-lock.json | Git 状态；另建干净源副本用于托管 worktree，不改未跟踪文件 |

## 原因与影响

- 缺口是预编译运行包、可核验归档与产物安装流程，而不是交接业务能力。
- 预计只改构建/安装脚本、package 清单、维护说明和验收；业务 TS 与 Skill 规则保持不变。
- 切换只替换当前用户 packages 中的 handoff 来源，不修改其他包、模型、凭据或缓存。

## 待核实

| 问题 | 影响 | 核实入口 |
|---|---|---|
| JS 导入与隔离安装已核实 | 当前宿主真实 loader/UI 回归通过，非空目标拒绝 | tests/artifact.test.mjs；详见 record.md |
| 历史/未来宿主兼容性未做全矩阵 | peer 范围为 *，不等于普遍兼容证明 | 更换宿主后重跑产物验收 |
| 下载包与正式构建包已核实一致 | Release 发布后下载校验与逐字节比较均通过 | record.md 的发布与安装证据 |
