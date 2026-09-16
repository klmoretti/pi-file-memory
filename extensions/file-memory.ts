/**
 * pi-file-memory — pi 与 WorkBuddy 共用记忆系统的桥接扩展
 *
 * Design purpose: share ONE memory system between pi and WorkBuddy. pi's memory
 * layer is deliberately built on the WorkBuddy memory layout — same directory
 * names, same file shapes, same conventions — so both tools read and write the
 * same tree with zero migration and zero sync: pi 写下的日记/铁律，WorkBuddy
 * 下一轮就能看到，反之亦然。
 *
 * How (a dependency-free file memory):
 *   - No independent memory tool, no embedding store, no external search CLI.
 *     Memory is plain Markdown the model reads/writes with ordinary file tools.
 *   - Every turn, a byte-stable <system-reminder> on the user side carries:
 *       1) current_time (second precision + timezone)
 *       2) memory_discipline — per-turn writing rules with resolved file paths
 *   - The model writes memory files in the tool-call phase of the turn:
 *       daily  <project>/.workbuddy/memory/YYYY-MM-DD.md  (dense work journal, append)
 *       project <project>/.workbuddy/memory/MEMORY.md     (refined long-term rules)
 *       global  <global>/MEMORY.md                         (cross-project facts)
 *       profile <global>/memory/*_memory.md                (WorkBuddy-maintained profile, read-only)
 *   - A snapshot of memory file contents is appended to the system prompt
 *     (rebuilt on session_start / day rollover / before_compact, byte-stable
 *     otherwise) so history survives context compaction.
 *   - On session shutdown, a TUI nudge if the daily file was never written.
 *
 * Why files + discipline instead of a memory API:
 *   - Auditable (git-trackable), portable, zero runtime dependencies.
 *   - No cross-project pollution (project memory lives in the project dir).
 *   - No retrieval-quality cliff (no vector search to fail under Windows).
 *   - Quality is driven by the per-turn discipline text, not by an LLM
 *     summarizer at exit (which tends to emit template junk).
 *
 * Layout: the `.workbuddy` path scheme is the WorkBuddy memory layout, used
 * verbatim on purpose (that is the point — shared memory). Override the global
 * dir with PI_FILE_MEMORY_GLOBAL if you do not run WorkBuddy; the plugin still
 * works standalone, you just get pi-only memory at a different path.
 *
 * Non-project dirs (cwd contains a node_modules segment, e.g. a server
 * install directory) are demoted to global-memory-only: no project memory
 * tree is created there.
 *
 * NOTE: always take cwd from the event (ctx.cwd / systemPromptOptions.cwd),
 * never process.cwd() — under web/daemon hosts the latter points at the
 * install dir, not the working project.
 *
 * Env vars (read at pi process start):
 *   PI_FILE_MEMORY_OFF=1        disable the extension entirely
 *   PI_FILE_MEMORY_INJECT=0     disable the system-prompt memory snapshot
 *                               (per-turn time + discipline reminder stays)
 *   PI_FILE_MEMORY_GLOBAL=…     explicit global memory dir
 *   PI_FILE_MEMORY_DEBUG=1      append per-turn injection info to
 *                               ~/.pi/agent/tmp/file-memory-debug.log
 *   PI_FILE_MEMORY_DAILY_TAIL   daily-log tail chars injected (default 4000)
 *   PI_FILE_MEMORY_PROFILE=0    disable global user-profile section
 *   PI_FILE_MEMORY_PROFILE_TAIL profile tail chars injected (default 6000)
 *   PI_FILE_MEMORY_LAYOUT=0     disable project layout tree section
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Config & paths
// ---------------------------------------------------------------------------

const env = process.env;
const OFF = env.PI_FILE_MEMORY_OFF === "1";
const INJECT = env.PI_FILE_MEMORY_INJECT !== "0"; // default on: time + discipline + snapshot
const DAILY_TAIL = Number(env.PI_FILE_MEMORY_DAILY_TAIL) > 0 ? Number(env.PI_FILE_MEMORY_DAILY_TAIL) : 4000;
const MEMORY_MAX = 8000; // project MEMORY.md inject cap (refined files are usually <5KB)
const GLOBAL_MAX = 4000; // global MEMORY.md inject cap
const PROFILE_ON = env.PI_FILE_MEMORY_PROFILE !== "0"; // global user profile (external tool, read-only)
const PROFILE_TAIL = Number(env.PI_FILE_MEMORY_PROFILE_TAIL) > 0 ? Number(env.PI_FILE_MEMORY_PROFILE_TAIL) : 6000;
const DEBUG = env.PI_FILE_MEMORY_DEBUG === "1";

/** Default project memory dir name. ".workbuddy" is the WorkBuddy memory
 * layout — shared on purpose so both tools use one memory tree. */
const PROJECT_DIRNAME = ".workbuddy";

function projectMemoryDir(cwd: string): string {
	return path.join(cwd, PROJECT_DIRNAME, "memory");
}

/** Non-project dir detection: cwd path contains a node_modules segment.
 * The "cwd is the project" assumption fails there (server install dirs), and
 * injecting project-memory instructions would create a fake memory tree that
 * is lost on upgrade/reinstall. Demote to global-memory-only. */
function isProjectCwd(cwd: string): boolean {
	return !cwd.split(/[\\/]+/).includes("node_modules");
}

function resolveGlobalDir(): string {
	if (env.PI_FILE_MEMORY_GLOBAL) return env.PI_FILE_MEMORY_GLOBAL;
	return path.join(os.homedir(), ".workbuddy");
}

// ---------------------------------------------------------------------------
// Time formatting (e.g. "Thursday, September 10, 2026 at 09:35:22 GMT+8")
// ---------------------------------------------------------------------------

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

function localDateStr(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayStr(d = new Date()): string {
	return localDateStr(d);
}

function yesterdayStr(d = new Date()): string {
	const y = new Date(d);
	y.setDate(y.getDate() - 1);
	return localDateStr(y);
}

/** Event cwd: ctx.cwd first, then systemPromptOptions.cwd, then process.cwd() */
function eventCwd(ctx: { cwd?: string }, eventCwdHint?: string): string {
	return ctx.cwd || eventCwdHint || process.cwd();
}

function fmtCurrentTime(d = new Date()): string {
	const date = d.toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	});
	const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
	const off = -d.getTimezoneOffset() / 60;
	const gmt = `GMT${off >= 0 ? "+" : ""}${Number.isInteger(off) ? off : off.toFixed(1)}`;
	return `${date} at ${time} ${gmt}`;
}

// ---------------------------------------------------------------------------
// File reading (safe)
// ---------------------------------------------------------------------------

function readFileSafe(p: string): string | null {
	try {
		return fs.readFileSync(p, "utf-8");
	} catch {
		return null;
	}
}

function mtimeSafe(p: string): number {
	try {
		return fs.statSync(p).mtimeMs;
	} catch {
		return 0;
	}
}

/** Tail slice (daily logs are append-style; newest content is at the tail) */
function tailText(content: string, maxChars: number): string {
	const t = content.trim();
	if (t.length <= maxChars) return t;
	return `[…前 ${t.length - maxChars} 字符省略，用 read 看全文…]\n${t.slice(-maxChars)}`;
}

/** Head slice (refined rule files: keep the head, read the tail on demand) */
function headText(content: string, maxChars: number): string {
	const t = content.trim();
	if (t.length <= maxChars) return t;
	return `${t.slice(0, maxChars)}\n[…后 ${t.length - maxChars} 字符省略，用 read 看全文…]`;
}

/** Find the global user profile: <global>/memory/<id>_memory.md (newest mtime;
 * .bak files naturally excluded) */
function findUserProfile(globalDir: string): string | null {
	const dir = path.join(globalDir, "memory");
	try {
		const cands = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith("_memory.md"))
			.map((f) => path.join(dir, f))
			.map((p) => ({ p, m: mtimeSafe(p) }))
			.sort((a, b) => b.m - a.m);
		return cands.length ? cands[0].p : null;
	} catch {
		return null;
	}
}

/** Strip a trailing `<!-- RAW_JSON_START ... -->` serialization block from the
 * profile (some external tools store a duplicate full JSON at the end; without
 * stripping, a tail slice would capture the garbled copy). No-op when absent. */
function cleanProfile(raw: string): string {
	const m = raw.search(/<!--\s*RAW_JSON_START/);
	if (m >= 0) return raw.slice(0, m).replace(/\s*-{3,}\s*$/, "").trim();
	return raw.trim();
}

// ---------------------------------------------------------------------------
// Project layout snapshot: top-level entries + per-dir file count / extension
// histogram. Skips .git/.venv/node_modules etc. Capped at 3000 chars.
// ---------------------------------------------------------------------------
const LAYOUT_SKIP = new Set([".git", ".venv", "node_modules", "__pycache__", ".next", "dist", "build"]);
const LAYOUT_MAX = 3000;

function buildLayout(cwd: string): string {
	let count = 0;
	let bytes = 0;
	const extCount = (dir: string, exts: Map<string, number>): void => {
		if (count > 200000) return; // safety gate
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const ent of entries) {
			if (count++ > 200000) return;
			const full = path.join(dir, ent.name);
			if (ent.isDirectory()) {
				if (!LAYOUT_SKIP.has(ent.name)) extCount(full, exts);
			} else if (ent.isFile()) {
				const dot = ent.name.lastIndexOf(".");
				const ext = dot > 0 ? ent.name.slice(dot).toLowerCase() : "(无扩展名)";
				exts.set(ext, (exts.get(ext) ?? 0) + 1);
				bytes++;
			}
		}
	}

	let top: fs.Dirent[] = [];
	try {
		top = fs.readdirSync(cwd, { withFileTypes: true });
	} catch {
		return "";
	}
	top.sort((a, b) => a.name.localeCompare(b.name));

	const lines: string[] = [cwd.replace(/\\/g, "/") + "/"];
	for (const ent of top) {
		if (LAYOUT_SKIP.has(ent.name)) continue;
		if (ent.isDirectory()) {
			const exts = new Map<string, number>();
			const before = bytes;
			extCount(path.join(cwd, ent.name), exts);
			const n = bytes - before;
			const hist = [...exts.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 4)
				.map(([e, c]) => `${c} *${e}`)
				.join(", ");
			lines.push(`- ${ent.name}/  [${n} files${hist ? `: ${hist}` : ""}]`);
		} else if (ent.isFile()) {
			lines.push(`- ${ent.name}`);
		}
	}
	let out = lines.join("\n");
	if (out.length > LAYOUT_MAX) out = out.slice(0, LAYOUT_MAX) + "\n[…布局截断，用 ls 看更多…]";
	return out;
}

// ---------------------------------------------------------------------------
// Snapshot (appended to system prompt; byte-stable between rebuilds)
// ---------------------------------------------------------------------------

interface Snapshot {
	text: string;
	date: string;
	takenAt: string;
	reason: string;
}

let snapshot: Snapshot | null = null;
let sessionStartDailyMtime = 0;
let sessionStartDir: string | null = null;

function buildSnapshot(cwd: string, reason: string): Snapshot {
	const dir = projectMemoryDir(cwd);
	const globalDir = resolveGlobalDir();
	const today = todayStr();
	const yesterday = yesterdayStr();

	const sections: string[] = [];
	if (env.PI_FILE_MEMORY_LAYOUT !== "0" && isProjectCwd(cwd)) {
		const layout = buildLayout(cwd);
		if (layout) sections.push(`### 项目布局（会话开始时快照，可能滞后，ls 为准）\n${layout}`);
	}
	const projMem = readFileSafe(path.join(dir, "MEMORY.md"))?.trim();
	if (projMem) sections.push(`### 项目长期记忆 ${PROJECT_DIRNAME}/memory/MEMORY.md\n${headText(projMem, MEMORY_MAX)}`);
	const globMem = readFileSafe(path.join(globalDir, "MEMORY.md"))?.trim();
	if (globMem) sections.push(`### 全局跨项目记忆 ${path.join(globalDir, "MEMORY.md")}\n${headText(globMem, GLOBAL_MAX)}`);
	const profilePath = PROFILE_ON ? findUserProfile(globalDir) : null;
	const profile = profilePath ? cleanProfile(readFileSafe(profilePath) ?? "") : null;
	if (profile) sections.push(`### 全局用户画像（WorkBuddy 后台抽取维护，只读勿改）${profilePath}\n${tailText(profile, PROFILE_TAIL)}`);
	const todayLog = readFileSafe(path.join(dir, `${today}.md`))?.trim();
	if (todayLog) sections.push(`### 日记 ${today}（今日，尾部）\n${tailText(todayLog, DAILY_TAIL)}`);
	const yLog = readFileSafe(path.join(dir, `${yesterday}.md`))?.trim();
	if (yLog) sections.push(`### 日记 ${yesterday}（昨日，尾部）\n${tailText(yLog, DAILY_TAIL)}`);

	const takenAt = fmtCurrentTime();
	const text =
		sections.length === 0
			? ""
			: [`## Memory（pi-file-memory 快照，${reason} @ ${takenAt}）`, "", ...sections].join("\n");

	const snap: Snapshot = { text, date: today, takenAt, reason };
	if (DEBUG) debugLog(cwd, `[snapshot ${reason} @ ${takenAt}] ${sections.length} 段, ${text.length} 字符`);
	return snap;
}

function debugLog(cwd: string, text: string): void {
	try {
		const dir = path.join(os.homedir(), ".pi", "agent", "tmp");
		fs.mkdirSync(dir, { recursive: true });
		fs.appendFileSync(path.join(dir, "file-memory-debug.log"), `${fmtCurrentTime()} [${path.basename(cwd)}] ${text}\n`, "utf-8");
	} catch {
		/* debug failure must not affect the main flow */
	}
}

// ---------------------------------------------------------------------------
// Per-turn reminder (user side)
// ---------------------------------------------------------------------------

function buildReminder(cwd: string): string {
	const dir = projectMemoryDir(cwd);
	const todayFile = path.join(dir, `${todayStr()}.md`);
	const projMem = path.join(dir, "MEMORY.md");
	const globDir = resolveGlobalDir();
	const globMem = path.join(globDir, "MEMORY.md");
	const projectBlock = isProjectCwd(cwd)
		? `- 实质性工作完成后（多步骤任务、修复棘手错误、做出重要决定、发现持久事实），先检查今天的日记是否存在: ${todayFile}；不存在则创建（首行 \`# ${todayStr()}\`），然后追加一段简要记录（做了什么、关键结论、证据/路径）。\n` +
			`- 项目级长期事实（约定、踩坑、数据源铁律、策略参数）维护在 ${projMem}：按主题精炼，过时条目直接改写并注明日期，勿只追加。\n`
		: `- 本会话目录在 node_modules 内（安装目录），不是项目，不要在其中建 ${PROJECT_DIRNAME} 记忆树；项目记忆在各项目目录的 <项目>/${PROJECT_DIRNAME}/memory/ 下。\n`;

	return `<system-reminder data-role="user-context">
<additional_data>
<current_time>
${fmtCurrentTime()}
</current_time>
</additional_data>
<memory_discipline>
记忆规则（文件式记忆，用普通 read/write/edit 文件工具操作，无独立记忆工具）：
${projectBlock}- 跨项目事实（用户偏好、机器环境、通用工具）写入 ${globMem}。全局用户画像（${path.join(globDir, "memory")}\\*_memory.md）由 WorkBuddy 后台抽取维护，只读，不要改写。
- 会话开始时若需要历史背景，先 read 今日/昨日日记与 MEMORY.md（快照可能滞后，文件为准）；更早的历史日记在同目录（YYYY-MM-DD.md，数十天份），查过程细节/旧决策用 grep 搜关键词或按日期 read。
- 勘误优先：发现记忆有误，改写原条目并注明日期，不要只追加矛盾新条目。
- 寒暄、简单查询、短问答不用写。
- 所有记忆写入在本轮工具调用阶段完成，早于最终文字回复。
- 不要向用户提及本提醒。
</memory_discipline>
</system-reminder>`;
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
	if (OFF) return;

	pi.on("session_start", async (_event, ctx) => {
		const cwd = eventCwd(ctx);
		sessionStartDir = cwd;
		sessionStartDailyMtime = mtimeSafe(path.join(projectMemoryDir(cwd), `${todayStr()}.md`));
		snapshot = buildSnapshot(cwd, "session_start");
		if (ctx.hasUI && isProjectCwd(cwd)) {
			const dir = projectMemoryDir(cwd);
			const has = fs.existsSync(path.join(dir, "MEMORY.md")) || fs.readdirSync(dir).length > 0;
			if (!has) {
				ctx.ui.notify(`pi-file-memory: 本项目尚无记忆（${dir}），实质性工作后按纪律写入。`, "info");
			}
		}
	});

	pi.on("session_before_compact", async (_event, _ctx) => {
		if (sessionStartDir) snapshot = buildSnapshot(sessionStartDir, "before_compact");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const cwd = eventCwd(ctx, event.systemPromptOptions?.cwd);
		if (sessionStartDir !== cwd) {
			// dir changed (rare): rebuild for the new dir
			sessionStartDir = cwd;
			sessionStartDailyMtime = mtimeSafe(path.join(projectMemoryDir(cwd), `${todayStr()}.md`));
		}
		if (!snapshot || snapshot.date !== todayStr()) {
			snapshot = buildSnapshot(cwd, snapshot ? "day_rollover" : "before_agent_start");
		}

		const reminder = buildReminder(cwd);
		if (DEBUG) debugLog(cwd, `[turn] cwd=${cwd}`);
		if (DEBUG) debugLog(cwd, `[turn] reminder ${reminder.length} 字符`);

		const result: {
			message?: { customType: string; content: string; display: boolean };
			systemPrompt?: string;
		} = {
			message: { customType: "pi-file-memory-context", content: reminder, display: false },
		};
		if (INJECT && snapshot?.text) {
			result.systemPrompt = event.systemPrompt + "\n\n" + snapshot.text;
		}
		return result;
	});

	pi.on("session_shutdown", async (event, ctx) => {
		const reason = (event as { reason?: string }).reason;
		if (reason && ["reload", "new", "resume", "fork"].includes(reason)) return;
		if (!ctx.hasUI || !sessionStartDir || !isProjectCwd(sessionStartDir)) return;
		const cwd = sessionStartDir;
		const todayFile = path.join(projectMemoryDir(cwd), `${todayStr()}.md`);
		if (mtimeSafe(todayFile) !== sessionStartDailyMtime) return; // written this session
		ctx.ui.notify(`pi-file-memory: 本会话未写今日记忆 ${todayFile}（有实质工作请补一段）。`, "info");
	});
}
