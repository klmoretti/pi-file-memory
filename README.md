# pi-file-memory

pi 与 WorkBuddy 共用记忆系统的桥接扩展 — [pi coding agent](https://pi.dev) 单文件
TypeScript extension, zero runtime dependencies.

**Design purpose: ONE memory system shared between pi and WorkBuddy.** The memory
layer is built directly on the WorkBuddy memory layout — same directory names, same
file shapes, same conventions — so both tools read and write the **same tree** with
zero migration and zero sync: 日记/铁律 pi 写下一轮 WorkBuddy 就能看到，反之亦然。

Mechanics: memory is plain Markdown (no memory tool, no vector store, no external
CLI); the model reads/writes files with ordinary read/write/edit tools under a
byte-stable per-turn discipline reminder, and a memory snapshot is appended to the
system prompt so history survives context compaction.

## Why files + discipline (not a memory API)

| Concern | pi-file-memory |
|---|---|
| Auditability | Plain Markdown, git-trackable, human-editable |
| Cross-project pollution | Project memory lives in `<project>/.workbuddy/memory/`, shared per project — never across projects |
| Retrieval quality | No vector search to fail; the model reads exactly the files the discipline points at |
| Windows / sandbox friendliness | No external CLI (no popup / re-exec surprises), only `node:fs/os/path` |
| Write quality | Driven by a byte-stable per-turn discipline reminder, not by an LLM exit-summarizer (which tends to emit template junk) |
| Surviving compaction | Memory snapshot appended to the system prompt, rebuilt on session start / day rollover / before-compact, byte-stable otherwise |

## Memory layout

```
<project>/.workbuddy/memory/YYYY-MM-DD.md   daily work journal (append-style, tail injected)
<project>/.workbuddy/memory/MEMORY.md       refined long-term project rules (head injected)
<global>/MEMORY.md                          cross-project facts: user prefs, machine env, tools (head injected)
<global>/memory/*_memory.md                 user profile extracted by WorkBuddy (read-only, tail injected)
```

`<global>` defaults to `~/.workbuddy` (override with `PI_FILE_MEMORY_GLOBAL`).
Directories whose cwd contains a `node_modules` segment (server install dirs) are
treated as non-projects: only global memory applies, no fake project tree is created.

## Install

```sh
# option 1: drop into your global extensions dir (auto-discovered)
cp file-memory.ts ~/.pi/agent/extensions/

# option 2: project-local, auto-discovered
mkdir -p .pi/extensions && cp file-memory.ts .pi/extensions/

# option 3: quick test in one session
pi -e ./file-memory.ts
```

Restart pi (or `/reload`) to pick it up.

## Per-turn behavior

1. **User-side reminder** (hidden from TUI): `<current_time>` (second precision +
   timezone) + `<memory_discipline>` with resolved file paths and writing rules.
2. **System-prompt snapshot**: project `MEMORY.md` + global `MEMORY.md` + user
   profile + today/yesterday daily tails + a top-level project layout tree
   (file counts + extension histograms). Rebuilt on `session_start`, day
   rollover, and `session_before_compact`; byte-stable in between so prompt
   caching stays effective.
3. **Shutdown nudge**: if the session did substantive work but never wrote the
   daily file, a one-line TUI reminder.

## Environment variables

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

Inject caps (project `MEMORY.md` 8000 chars, global 4000 chars, layout 3000 chars)
are compile-time constants — edit `file-memory.ts` if you need more.

## Sharing memory with WorkBuddy

The `.workbuddy` path scheme is the WorkBuddy memory layout, used verbatim on
purpose — that is the point of this plugin:

- **Project tree** `<project>/.workbuddy/memory/`: pi and WorkBuddy sessions in
  the same project append to the same daily journals and the same `MEMORY.md`.
- **Global tree** `~/.workbuddy/`: shared cross-project `MEMORY.md` and the
  `memory/*_memory.md` profile (WorkBuddy extracts it in the background; pi
  treats it as read-only and strips the trailing `<!-- RAW_JSON_START … -->`
  duplicate when injecting).
- No sync layer, no export/import: the files **are** the shared store.

If you do not run WorkBuddy, the plugin still works standalone as a file memory
for pi — just point `PI_FILE_MEMORY_GLOBAL` at any directory you prefer.
This extension is not affiliated with WorkBuddy; it only reuses the public
on-disk layout.

## Privacy

Memory files are **your private data** — work journals, account/machine facts,
strategy parameters. The extension itself contains no credentials and does not
transmit anything. Before committing a project to git:

- add `.workbuddy/` (and your global dir) to `.gitignore`, or
- keep a sanitized copy if you want versioned memory.

## License

MIT — see [LICENSE](LICENSE).
