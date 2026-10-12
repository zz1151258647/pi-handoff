# v1 验收矩阵

目标：减少小窗口过早检查和无新事实的暂缓重复；保留大窗口及原有业务判断。

| ID | Plan 条目 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|
| AC-01 | 01 | 128k 在 50% 不触发、80% 触发；1M 仍在 50% 触发；环境变量覆盖生效 | verified | `node tests/simulate.test.js` 第 8–9 组通过（本次运行） |
| AC-02 | 01 | 默认暂缓不在下一轮重复，已评估后间隔 3 次压缩；显式 next_turn 保留 | verified | `node tests/simulate.test.js` 第 2、10 组通过（本次运行） |
| AC-03 | 01 | 原有测试全部通过，文档与实现一致 | verified | `node tests/simulate.test.js` 全部通过；`git diff --check` 通过（本次运行） |
