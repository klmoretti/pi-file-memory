# pi-file-memory

File-based persistent memory for the [pi coding agent](https://pi.dev) — a single
TypeScript extension, zero runtime dependencies.

`文件式记忆`：记忆就是普通 Markdown 文件，模型用 read/write/edit 按纪律实时读写；
无独立记忆工具、无向量库、无外部 CLI。路径与 WorkBuddy 记忆布局兼容（同路径共享记忆）。

## Why files + discipline (not a memory API)

| Concern | pi-file-memory |
|---|---|
| Auditability | Plain Markdown, git-trackable, human-editable |
| Cross-project pollution | Project memory lives in `<project>/.workbuddy/memory/`, never shared |
| Retrieval quality | No vector search to fail; the model reads exactly the files the discipline points at |
| Windows / sandbox friendliness | No external CLI (no popup / re-exec surprises), only `node:fs/os/path` |
| Write quality | Driven by a byte-stable per-turn discipline reminder, not by an LLM exit-summarizer (which tends to emit template junk) |
| Surviving compaction | Memory snapshot appended to the system prompt, rebuilt on session start / day rollover / before-compact, byte-stable otherwise |

## Memory layout

```
<project>/.workbuddy/memory/YYYY-MM-DD.md   daily work journal (append-style, tail injected)
<project>/.workbuddy/memory/MEMORY.md       refined long-term project rules (head injected)
<global>/MEMORY.md                          cross-project facts: user prefs, machine env, tools (head injected)
<global>/memory/*_memory.md                 user profile maintained by an external tool (read-only, tail injected)
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

## WorkBuddy compatibility

Default paths intentionally match the WorkBuddy memory layout, so pi and
WorkBuddy can read/write the **same** memory tree with zero migration (daily
journals, `MEMORY.md`, and the `memory/*_memory.md` profile block). The profile
strips a trailing `<!-- RAW_JSON_START … -->` serialization block when present.
This extension is not affiliated with WorkBuddy; compatibility is opt-out only
by changing `PROJECT_DIRNAME` / `PI_FILE_MEMORY_GLOBAL`.

## Privacy

Memory files are **your private data** — work journals, account/machine facts,
strategy parameters. The extension itself contains no credentials and does not
transmit anything. Before committing a project to git:

- add `.workbuddy/` (and your global dir) to `.gitignore`, or
- keep a sanitized copy if you want versioned memory.

## License

MIT — see [LICENSE](LICENSE).
