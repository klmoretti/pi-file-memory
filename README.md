# pi-file-memory

pi 与 WorkBuddy 共用记忆系统的桥接扩展 — [pi coding agent](https://pi.dev) 单文件
TypeScript extension, zero runtime dependencies.

**设计目标：pi 与 WorkBuddy 共用一套记忆系统。** 记忆层直接构建在 WorkBuddy 记忆
布局之上——相同目录名、相同文件形态、相同约定，两个工具读写**同一棵树**，零迁移、
零同步：pi 写下的日记/铁律，WorkBuddy 下一轮就能看到，反之亦然。

**Language: [English](#english) | 中文（默认）**

## 工作原理

记忆就是普通 Markdown 文件（无记忆工具、无向量库、无外部 CLI），模型用
read/write/edit 在每轮的工具调用阶段按纪律读写；同时把记忆文件快照追加到
system prompt，保证历史在上下文压缩后仍然存活。

| 关注点 | 方案 |
|---|---|
| 可审计 | 纯 Markdown，可 git 版本管理、可人工编辑 |
| 跨项目污染 | 项目记忆在 `<project>/.workbuddy/memory/`，按项目隔离共享，绝不跨项目 |
| 检索质量 | 无向量搜索可失效；模型按纪律精确定位该读的文件 |
| Windows/沙箱友好 | 无外部 CLI（无弹窗/re-exec 意外），仅用 `node:fs/os/path` |
| 写入质量 | 由逐轮字节稳定的纪律提醒驱动，而非退出时 LLM 摘要（后者易产出模板化垃圾） |
| 抗上下文压缩 | 记忆快照追加到 system prompt，在会话开始/切换工作目录/跨日/压缩前重建，其余轮次字节稳定 |

## 记忆布局

```
<project>/.workbuddy/memory/YYYY-MM-DD.md   每日工作日志（追加式，注入尾部）
<project>/.workbuddy/memory/MEMORY.md       精炼的项目长期铁律（注入头部）
<global>/MEMORY.md                          跨项目事实：用户偏好/机器环境/工具（注入头部）
<global>/memory/*_memory.md                 WorkBuddy 后台抽取的用户画像（只读，注入尾部）
```

`<global>` 默认 `~/.workbuddy`（`PI_FILE_MEMORY_GLOBAL` 可覆盖）。
cwd 含 `node_modules` 段的目录（服务器安装目录）视为非项目：只注入全局记忆，不建项目记忆树。

## 安装

```sh
# 推荐：pi 包管理器一键安装
pi install npm:pi-file-memory

# 或：从 git 安装（pin 到 tag）
pi install git:github.com/klmoretti/pi-file-memory@v0.1.2

# 项目级安装（写入 .pi/settings.json，可随仓库共享）
pi install -l npm:pi-file-memory

# 不安装，仅当前会话试用
pi -e npm:pi-file-memory

# 手动：拷进扩展目录
mkdir -p ~/.pi/agent/extensions && cp extensions/file-memory.ts ~/.pi/agent/extensions/
```

重启 pi（或 `/reload`）生效。管理：`pi list` / `pi remove npm:pi-file-memory` /
`pi update --extensions`。

> **注意**：如果之前手工拷过扩展（比如自己维护的 `wb-memory.ts`），装包前后删掉
> 手工版，否则记忆提醒会被注入两次。

## 每轮行为

1. **用户侧提醒**（TUI 中隐藏）：`<current_time>`（秒级 + 时区）+
   `<memory_discipline>`（解析好的文件路径 + 写入规则）。时间逐轮更新；纪律文本在路径和日期不变时字节稳定。
2. **system prompt 快照**：项目 `MEMORY.md` + 全局 `MEMORY.md` + 用户画像 +
   今日/昨日日记尾部 + 项目顶层布局树（文件数 + 扩展名直方图）。
   在 `session_start`、工作目录切换、跨日、`session_before_compact` 时重建，其余轮次字节不变。
3. **收尾提醒**：退出时若未检测到今日日志更新，TUI 提示一句；不判断会话是否做过实质工作。

## 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `PI_FILE_MEMORY_OFF` | – | `=1` 整体停用 |
| `PI_FILE_MEMORY_INJECT` | 开 | `=0` 关闭 system prompt 快照（逐轮时间+纪律提醒保留） |
| `PI_FILE_MEMORY_GLOBAL` | `~/.workbuddy` | 显式指定全局记忆目录 |
| `PI_FILE_MEMORY_DEBUG` | – | `=1` 每轮注入信息追加到 `~/.pi/agent/tmp/file-memory-debug.log` |
| `PI_FILE_MEMORY_DAILY_TAIL` | `4000` | 每日日志注入的尾部字符数 |
| `PI_FILE_MEMORY_PROFILE` | 开 | `=0` 关闭用户画像段 |
| `PI_FILE_MEMORY_PROFILE_TAIL` | `6000` | 画像注入的尾部字符数 |
| `PI_FILE_MEMORY_LAYOUT` | 开 | `=0` 关闭项目布局树段 |

注入上限（项目 `MEMORY.md` 8000 字符、全局 4000、布局 3000）是编译期常量，
需要更大直接改 `extensions/file-memory.ts`。

## 与 WorkBuddy 共享记忆

`.workbuddy` 路径方案即 WorkBuddy 记忆布局，按原样使用是刻意为之——这就是本插件的
存在意义：

- **项目树** `<project>/.workbuddy/memory/`：同一项目里 pi 与 WorkBuddy 的会话
  追加同一批每日日志、维护同一份 `MEMORY.md`。
- **全局树** `~/.workbuddy/`：共享跨项目 `MEMORY.md` 与 `memory/*_memory.md`
  画像（WorkBuddy 后台抽取，pi 只读；注入时剥离尾部
  `<!-- RAW_JSON_START … -->` 重复块）。
- 没有同步层，没有导入导出：**文件本身就是共享存储**。

不运行 WorkBuddy 时，本插件可独立作为 pi 的文件式记忆使用——把
`PI_FILE_MEMORY_GLOBAL` 指向任意目录即可。本扩展与 WorkBuddy 无隶属关系，
仅复用其磁盘布局。

## 隐私

记忆文件是**私有数据**——工作日志、账号/机器事实、策略参数。插件本身不含任何
凭据，也不外传任何内容。项目提交 git 前：

- 把 `.workbuddy/`（及你的全局目录）加入 `.gitignore`；或
- 如需版本化记忆，保留脱敏副本。

## License

MIT — 见 [LICENSE](LICENSE)。

---

<a id="english"></a>

## English

**Design purpose: ONE memory system shared between pi and WorkBuddy.** The memory
layer is built directly on the WorkBuddy memory layout — same directory names, same
file shapes, same conventions — so both tools read and write the **same tree** with
zero migration and zero sync.

### How it works

Memory is plain Markdown (no memory tool, no vector store, no external CLI). The
model reads/writes files with ordinary read/write/edit tools under a byte-stable
per-turn discipline reminder, and a memory snapshot is appended to the system
prompt so history survives context compaction.

| Concern | pi-file-memory |
|---|---|
| Auditability | Plain Markdown, git-trackable, human-editable |
| Cross-project pollution | Project memory lives in `<project>/.workbuddy/memory/`, shared per project — never across projects |
| Retrieval quality | No vector search to fail; the model reads exactly the files the discipline points at |
| Windows / sandbox friendliness | No external CLI, only `node:fs/os/path` |
| Write quality | Driven by a byte-stable per-turn discipline reminder, not by an LLM exit-summarizer (which tends to emit template junk) |
| Surviving compaction | Memory snapshot appended to the system prompt, rebuilt on session start / working-directory change / day rollover / before-compact, byte-stable otherwise |

### Memory layout

```
<project>/.workbuddy/memory/YYYY-MM-DD.md   daily work journal (append-style, tail injected)
<project>/.workbuddy/memory/MEMORY.md       refined long-term project rules (head injected)
<global>/MEMORY.md                          cross-project facts: user prefs, machine env, tools (head injected)
<global>/memory/*_memory.md                 user profile extracted by WorkBuddy (read-only, tail injected)
```

`<global>` defaults to `~/.workbuddy` (override with `PI_FILE_MEMORY_GLOBAL`).
Directories whose cwd contains a `node_modules` segment (server install dirs) are
treated as non-projects: only global memory applies, no project tree is created.

### Install

```sh
# recommended: pi package manager, one-liner
pi install npm:pi-file-memory

# or: from git, pinned tag
pi install git:github.com/klmoretti/pi-file-memory@v0.1.2

# project-local install (writes .pi/settings.json, shareable in your repo)
pi install -l npm:pi-file-memory

# try without installing (temp dir, current run only)
pi -e npm:pi-file-memory

# manual: copy the extension into your extensions dir
mkdir -p ~/.pi/agent/extensions && cp extensions/file-memory.ts ~/.pi/agent/extensions/
```

Restart pi (or `/reload`) to pick it up. Manage with `pi list` /
`pi remove npm:pi-file-memory` / `pi update --extensions`.

> **Note**: if you already hand-copy an extension (e.g. your own `wb-memory.ts`),
> remove the hand-copied file before/after installing the package, or the memory
> reminder gets injected twice.

### Per-turn behavior

1. **User-side reminder** (hidden in TUI): `<current_time>` (second precision +
   timezone) + `<memory_discipline>` with resolved file paths and writing rules;
   time updates each turn; the discipline text is byte-stable while paths and
   the date are unchanged.
2. **System-prompt snapshot**: project `MEMORY.md` + global `MEMORY.md` + user
   profile + today/yesterday daily tails + a top-level project layout tree
   (file counts + extension histograms). Rebuilt on `session_start`, day
   rollover, working-directory changes, and `session_before_compact`;
   byte-stable in between.
3. **Shutdown nudge**: a one-line TUI reminder if no update to today's daily
   file was detected at exit; substantive work is not tracked.

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `PI_FILE_MEMORY_OFF` | – | `=1` disables the whole extension |
| `PI_FILE_MEMORY_INJECT` | on | `=0` disables the system-prompt snapshot (per-turn time + discipline stays) |
| `PI_FILE_MEMORY_GLOBAL` | `~/.workbuddy` | explicit global memory dir |
| `PI_FILE_MEMORY_DEBUG` | – | `=1` appends per-turn injection info to `~/.pi/agent/tmp/file-memory-debug.log` |
| `PI_FILE_MEMORY_DAILY_TAIL` | `4000` | daily-log tail chars injected per file |
| `PI_FILE_MEMORY_PROFILE` | on | `=0` disables the user-profile section |
| `PI_FILE_MEMORY_PROFILE_TAIL` | `6000` | profile tail chars injected |
| `PI_FILE_MEMORY_LAYOUT` | on | `=0` disables the project layout tree section |

Inject caps (project `MEMORY.md` 8000 chars, global 4000, layout 3000) are
compile-time constants — edit `extensions/file-memory.ts` if you need more.

### Sharing memory with WorkBuddy

The `.workbuddy` path scheme is the WorkBuddy memory layout, used verbatim on
purpose — that is the point of this plugin:

- **Project tree** `<project>/.workbuddy/memory/`: pi and WorkBuddy sessions in
  the same project append to the same daily journals and the same `MEMORY.md`.
- **Global tree** `~/.workbuddy/`: shared cross-project `MEMORY.md` and the
  `memory/*_memory.md` profile (WorkBuddy extracts it in the background; pi
  treats it as read-only and strips the trailing `<!-- RAW_JSON_START … -->`
  duplicate when injecting).
- No sync layer, no export/import: the files **are** the shared store.

Without WorkBuddy, the plugin still works standalone as a file memory for pi —
point `PI_FILE_MEMORY_GLOBAL` at any directory you prefer. This extension is not
affiliated with WorkBuddy; it only reuses the public on-disk layout.

### Privacy

Memory files are **your private data** — work journals, account/machine facts,
strategy parameters. The extension itself contains no credentials and does not
transmit anything. Before committing a project to git:

- add `.workbuddy/` (and your global dir) to `.gitignore`, or
- keep a sanitized copy if you want versioned memory.

### License

MIT — see [LICENSE](LICENSE).
