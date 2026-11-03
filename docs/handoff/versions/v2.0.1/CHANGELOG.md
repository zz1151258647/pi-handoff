# v2.0.1 已验证交付

> 发布状态：已于 2026-11-03 发布 [v2.0.1](https://github.com/zz1151258647/pi-handoff/releases/tag/v2.0.1)。源码/tag 为 2d16a62；正式下载校验及本机固定来源切换完成。详见 [STATUS](STATUS.md) 与 [记录](features/01-runtime-artifact/record.md)。

- **01 运行包分发**：新增离线 JS 构建、9 文件严格白名单归档与 SHA256，运行 manifest 只引用 JS 与完整 Skill，宿主 SDK/typebox 不打包。
- **01 安全安装**：支持复制到空版本目录，拒绝非空、重叠及符号链接目标；不自动修改设置或交接缓存。
- **01 验证**：源码与运行包各 15 组真实 Pi 组件回归通过，另覆盖包内容、Skill、校验、归档尾部与安装保护；不涉及真实模型或当前终端人工验收。
- 包含先前已验收的 Tab 连续补全、仅「交接/接续」菜单与交接材料简短显示修复；压缩后仍只显示灰色次数。

正式产物：`pi-handoff-2.0.1.tgz`、`SHA256SUMS.txt`。

SHA256：`28f907beb7c8d62a352dcac00bf48e440e5f52f5311fddc371dbce68fa090c2e`。

本版规格与授权见 [Plan 01](plan.md)、[当前规格](features/01-runtime-artifact/spec.md)。
