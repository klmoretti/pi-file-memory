# Changelog

## 0.1.0 (2026-09-16)

- pi 与 WorkBuddy 共用记忆系统的桥接扩展首版。
- 单文件 TypeScript 扩展（`extensions/file-memory.ts`），零运行时依赖。
- 每轮注入：用户侧 `<current_time>` + 记忆纪律提醒（字节稳定）；system prompt
  记忆快照（会话开始/跨日/压缩前重建）。
- 记忆布局：项目 `<project>/.workbuddy/memory/`（每日日志 + MEMORY.md），
  全局 `~/.workbuddy/`（跨项目 MEMORY.md + 只读用户画像）。
- 收尾提醒：会话未写当日日志时 TUI 提示。
- 环境变量开关：`PI_FILE_MEMORY_OFF/INJECT/GLOBAL/DEBUG/DAILY_TAIL/PROFILE/PROFILE_TAIL/LAYOUT`。
- 标准 pi 包结构，支持 `pi install git:github.com/Halflifefa/pi-file-memory@v0.1.0`（npm 包发布后支持 `pi install npm:pi-file-memory`）。

## 0.1.0 (2026-09-16)

- Initial release: file-memory bridge sharing one memory tree between pi and WorkBuddy.
- Single-file TypeScript extension (`extensions/file-memory.ts`), zero runtime dependencies.
- Per-turn injection: user-side `<current_time>` + byte-stable memory discipline
  reminder; system-prompt memory snapshot (rebuilt on session start / day rollover
  / before compact).
- Memory layout: project `<project>/.workbuddy/memory/` (daily journal + MEMORY.md),
  global `~/.workbuddy/` (cross-project MEMORY.md + read-only user profile).
- Shutdown nudge when the daily file was never written.
- Env switches: `PI_FILE_MEMORY_OFF/INJECT/GLOBAL/DEBUG/DAILY_TAIL/PROFILE/PROFILE_TAIL/LAYOUT`.
- Standard pi package: installable via `pi install git:github.com/Halflifefa/pi-file-memory@v0.1.0` (`pi install npm:pi-file-memory` once the npm package is published).
