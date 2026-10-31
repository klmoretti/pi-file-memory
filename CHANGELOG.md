# Changelog

## 0.1.3 (2026-10-31)

- README 的 git 安装示例 pin 从 v0.1.1 更新为 v0.1.2（中英文各一处）。
- 扩展文件头注释补全记忆写入时序：写入先于正文、主答案为本轮最后输出（与 0.1.2 的注入规则一致）。
- Update the README git-install example pin from v0.1.1 to v0.1.2 (both
  language sections).
- Extend the extension header comment with the memory-write ordering (writes
  precede the answer; the answer is the turn's final output), matching the 0.1.2
  injected rule.

## 0.1.2 (2026-10-31)

- 修复新项目记忆目录缺失或不可读时 `session_start` 抛出异常。
- 切换工作目录时立即重建快照，避免继续注入上一个项目的记忆。
- `node_modules` 目录只注入全局记忆，不再读取项目长期记忆及日记。
- 修正注入规则中记忆写入顺序的歧义表述：记忆写入先于正文，主答案之后不得再出现工具调用或追加文字（防主答案被记忆写入截断成多个气泡）。
- 修正用户画像通配路径、repository URL 和双语 README 的版本及行为描述。
- 添加启动、目录切换和非项目目录的回归测试（`npm test`，Node.js 22.19+）。
- Fix startup with missing/unreadable memory directories, rebuild snapshots on
  working-directory changes, and exclude project memory under `node_modules`.
- Clarify the memory-write ordering rule so the final answer is never split by
  a memory-write tool call or a trailing one-liner.
- Correct profile paths, repository metadata, and bilingual installation and
  behavior documentation; add regression coverage via `npm test` (Node.js 22.19+).

## 0.1.1 (2026-09-16)

- 修复 Linux 上全局记忆路径拼接 bug：两处模板里硬编码反斜杠（`MEMORY.md` 与
  `*_memory.md` 路径描述），改为 `path.join`，所有平台渲染为原生分隔符。
- 0.1.0 中 `${dir}\MEMORY.md` 在 Linux 渲染为字面反斜杠路径；`\memory\*_memory.md`
  的无效转义在所有平台吞掉反斜杠（`.workbuddymemory*_memory.md`）。

## 0.1.1 (2026-09-16)

- Fix Linux path-join bug: two template literals hard-coded backslashes
  (`MEMORY.md` and the `*_memory.md` path description); now built with
  `path.join` so every platform renders native separators.
  (In 0.1.0 `${dir}\MEMORY.md` rendered a literal backslash on Linux, and the
  invalid escape in `\memory\*_memory.md` dropped the backslash on all platforms.)

## 0.1.0 (2026-09-16)

- pi 与 WorkBuddy 共用记忆系统的桥接扩展首版。
- 单文件 TypeScript 扩展（`extensions/file-memory.ts`），零运行时依赖。
- 每轮注入：用户侧 `<current_time>` + 记忆纪律提醒（字节稳定）；system prompt
  记忆快照（会话开始/跨日/压缩前重建）。
- 记忆布局：项目 `<project>/.workbuddy/memory/`（每日日志 + MEMORY.md），
  全局 `~/.workbuddy/`（跨项目 MEMORY.md + 只读用户画像）。
- 收尾提醒：会话未写当日日志时 TUI 提示。
- 环境变量开关：`PI_FILE_MEMORY_OFF/INJECT/GLOBAL/DEBUG/DAILY_TAIL/PROFILE/PROFILE_TAIL/LAYOUT`。
- 标准 pi 包结构，支持 `pi install npm:pi-file-memory` 与
  `pi install git:github.com/Halflifefa/pi-file-memory@v0.1.0`。

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
- Standard pi package: installable via `pi install npm:pi-file-memory` and
  `pi install git:github.com/Halflifefa/pi-file-memory@v0.1.0`.
