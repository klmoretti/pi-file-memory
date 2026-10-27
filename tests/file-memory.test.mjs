import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-file-memory-test-"));
	const globalDir = path.join(root, "global");
	const config = {
		PI_FILE_MEMORY_GLOBAL: globalDir,
		PI_FILE_MEMORY_OFF: "0",
		PI_FILE_MEMORY_INJECT: "1",
		PI_FILE_MEMORY_LAYOUT: "0",
		PI_FILE_MEMORY_PROFILE: "1",
		PI_FILE_MEMORY_DEBUG: "0",
		PI_FILE_MEMORY_DAILY_TAIL: "4000",
		PI_FILE_MEMORY_PROFILE_TAIL: "6000",
	};
	const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
	Object.assign(process.env, config);
	t.after(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		fs.rmSync(root, { recursive: true, force: true });
	});
	fs.mkdirSync(path.join(globalDir, "memory"), { recursive: true });
	fs.writeFileSync(path.join(globalDir, "MEMORY.md"), "GLOBAL_RULE");
	fs.writeFileSync(path.join(globalDir, "memory", "user_memory.md"), "GLOBAL_PROFILE");
	// A unique .mts copy gives each test fresh module state without a package-type warning.
	const extension = path.join(root, "file-memory.mts");
	fs.copyFileSync(new URL("../extensions/file-memory.ts", import.meta.url), extension);
	const { default: init } = await import(pathToFileURL(extension).href);
	const handlers = {};
	init({ on: (name, handler) => { handlers[name] = handler; } });
	const notifications = [];
	const context = (cwd, hasUI = false) => ({
		cwd, hasUI, ui: { notify: (message) => notifications.push(message) },
	});
	const project = (name, marker) => {
		const cwd = path.join(root, name);
		const dir = path.join(cwd, ".workbuddy", "memory");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "MEMORY.md"), marker);
		return cwd;
	};
	return { root, globalDir, handlers, notifications, context, project };
}

test("new projects start without creating a memory tree", async (t) => {
	const f = await fixture(t);
	const cwd = path.join(f.root, "fresh");
	fs.mkdirSync(cwd);
	await f.handlers.session_start({}, f.context(cwd, true));
	assert.equal(f.notifications.length, 1);
	assert.match(f.notifications[0], /本项目尚无记忆/);
	assert.equal(fs.existsSync(path.join(cwd, ".workbuddy")), false);
});

test("a non-directory memory path does not abort startup", async (t) => {
	const f = await fixture(t);
	const cwd = path.join(f.root, "invalid-memory-dir");
	fs.mkdirSync(path.join(cwd, ".workbuddy"), { recursive: true });
	fs.writeFileSync(path.join(cwd, ".workbuddy", "memory"), "not a directory");
	await f.handlers.session_start({}, f.context(cwd, true));
	assert.equal(f.notifications.length, 1);
});

test("changing cwd replaces the project snapshot in the same day", async (t) => {
	const f = await fixture(t);
	const a = f.project("a", "PROJECT_A_RULE");
	const b = f.project("b", "PROJECT_B_RULE");
	await f.handlers.session_start({}, f.context(a));
	for (const [cwd, expected, excluded] of [[b, "PROJECT_B_RULE", "PROJECT_A_RULE"], [a, "PROJECT_A_RULE", "PROJECT_B_RULE"]]) {
		const result = await f.handlers.before_agent_start({ systemPrompt: "BASE" }, f.context(cwd));
		assert.ok(result.systemPrompt.startsWith("BASE\n\n"));
		assert.ok(result.systemPrompt.includes(expected));
		assert.ok(!result.systemPrompt.includes(excluded));
		assert.ok(result.message.content.includes(path.join(cwd, ".workbuddy", "memory")));
	}
});

test("node_modules cwd injects global memory and profile only", async (t) => {
	const f = await fixture(t);
	const cwd = f.project(path.join("node_modules", "pkg"), "LOCAL_RULE_MUST_NOT_APPEAR");
	const date = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	for (const d of [today, yesterday]) {
		fs.writeFileSync(path.join(cwd, ".workbuddy", "memory", `${date(d)}.md`), "LOCAL_LOG_MUST_NOT_APPEAR");
	}
	await f.handlers.session_start({}, f.context(cwd, true));
	const result = await f.handlers.before_agent_start({ systemPrompt: "BASE" }, f.context(cwd));
	assert.ok(result.systemPrompt.includes("GLOBAL_RULE"));
	assert.ok(result.systemPrompt.includes("GLOBAL_PROFILE"));
	assert.ok(!result.systemPrompt.includes("LOCAL_RULE_MUST_NOT_APPEAR"));
	assert.ok(!result.systemPrompt.includes("LOCAL_LOG_MUST_NOT_APPEAR"));
	assert.equal(f.notifications.length, 0);
	assert.ok(result.message.content.includes(path.join(f.globalDir, "memory", "*_memory.md")));
});

test("same-project snapshots stay stable until an explicit rebuild", async (t) => {
	const f = await fixture(t);
	const cwd = f.project("stable", "ORIGINAL_RULE");
	await f.handlers.session_start({}, f.context(cwd));
	const before = await f.handlers.before_agent_start({ systemPrompt: "BASE" }, f.context(cwd));
	fs.writeFileSync(path.join(cwd, ".workbuddy", "memory", "MEMORY.md"), "UPDATED_RULE");
	const unchanged = await f.handlers.before_agent_start({ systemPrompt: "BASE" }, f.context(cwd));
	assert.equal(unchanged.systemPrompt, before.systemPrompt);
	await f.handlers.session_before_compact({}, f.context(cwd));
	const rebuilt = await f.handlers.before_agent_start({ systemPrompt: "BASE" }, f.context(cwd));
	assert.ok(rebuilt.systemPrompt.includes("UPDATED_RULE"));
	assert.ok(!rebuilt.systemPrompt.includes("ORIGINAL_RULE"));
});
