import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function createFakePi() {
	const handlers = new Map<string, Function>();
	const entries: Array<{ type: string; data: unknown }> = [];
	const notifications: Array<{ message: string; type: string }> = [];
	const tools = new Set<string>();
	const activeTools: string[] = [];
	return {
		handlers, entries, tools, activeTools,
		on(event: string, handler: Function) { handlers.set(event, handler); },
		registerCommand() {}, registerShortcut() {},
		appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
		events: { emit() {} }, getAllTools: () => [...tools].map((name) => ({ name })), getActiveTools: () => [...activeTools], getThinkingLevel: () => "medium",
		notifications,
		setActiveTools(value: string[]) { activeTools.splice(0, activeTools.length, ...value); }, setThinkingLevel() {}, async setModel() { return true; },
	};
}

function deferredScheduler() {
	let callback: (() => void) | undefined;
	return {
		scheduler: { defer(next: () => void | Promise<void>) { callback = next; } },
		async flush() { await callback?.(); },
	};
}

function sessionContext(notifications: Array<{ message: string; type: string }> = []) {
	return { model: undefined, isIdle: () => true, modelRegistry: { find() {}, getAll: () => [] }, sessionManager: { getBranch: () => [] }, ui: { setStatus() {}, notify(message: string, type: string) { notifications.push({ message, type }); } } };
}

async function expectDeferredWarning(configure: (agent: string) => void, expected: RegExp): Promise<void> {
	const agent = mkdtempSync(join(tmpdir(), "pi-modes-load-"));
	mkdirSync(join(agent, "modes"));
	configure(agent);
	const prior = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agent;
	try {
		const { registerPiModes } = await import("../src/index.ts");
		const pi = createFakePi();
		const deferred = deferredScheduler();
		registerPiModes(pi as any, deferred.scheduler);
		assert.deepEqual(pi.entries, []);
		const sessionStart = pi.handlers.get("session_start");
		assert.ok(sessionStart);
		await sessionStart({}, sessionContext(pi.notifications));
		await deferred.flush();
		const warning = pi.entries[0] as { type: string; data: { message?: string } };
		assert.match(String(warning.data.message), expected);
		assert.match(pi.notifications[0]?.message ?? "", expected);
		assert.equal(pi.notifications[0]?.type, "warning");
	} finally {
		if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prior;
	}
}

test("factory defers invalid modes.json warnings until session_start", async () => {
	await expectDeferredWarning((agent) => writeFileSync(join(agent, "modes.json"), "{"), /Invalid modes.json/);
});

test("factory defers malformed mode diagnostics until session_start", async () => {
	await expectDeferredWarning((agent) => writeFileSync(join(agent, "modes", "broken.md"), "---\nname: broken\n"), /unterminated/);
});

test("lifecycle restore waits for tools registered later in session_start", async () => {
	const agent = mkdtempSync(join(tmpdir(), "pi-modes-load-"));
	mkdirSync(join(agent, "modes"));
	writeFileSync(join(agent, "modes", "delegator.md"), "---\nname: delegator\n---\n");
	const prior = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agent;
	try {
		const { registerPiModes } = await import("../src/index.ts");
		const pi = createFakePi();
		const deferred = deferredScheduler();
		pi.tools.add("read");
		pi.activeTools.push("read");
		registerPiModes(pi as any, deferred.scheduler);
		const context = sessionContext(pi.notifications);
		(context.sessionManager as any).getBranch = () => [{ type: "custom", customType: "pi-modes-state", data: { version: 1, activeModeName: "delegator", baseline: { thinking: "medium", tools: ["read", "late_tool"] } } }];
		const start = pi.handlers.get("session_start");
		assert.ok(start);
		await start({}, context);
		pi.tools.add("late_tool");
		await deferred.flush();
		assert.deepEqual(pi.activeTools, ["read", "late_tool"]);
		assert.equal(pi.notifications.length, 0);
		assert.equal(pi.entries.length, 0);
	} finally {
		if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prior;
	}
});

test("lifecycle restore warns after deferred validation when a tool is permanently missing", async () => {
	const agent = mkdtempSync(join(tmpdir(), "pi-modes-load-"));
	mkdirSync(join(agent, "modes"));
	writeFileSync(join(agent, "modes", "delegator.md"), "---\nname: delegator\n---\n");
	const prior = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agent;
	try {
		const { registerPiModes } = await import("../src/index.ts");
		const pi = createFakePi();
		const deferred = deferredScheduler();
		pi.tools.add("read");
		pi.activeTools.push("read");
		registerPiModes(pi as any, deferred.scheduler);
		const context = sessionContext(pi.notifications);
		(context.sessionManager as any).getBranch = () => [{ type: "custom", customType: "pi-modes-state", data: { version: 1, activeModeName: "delegator", baseline: { thinking: "medium", tools: ["read", "missing_tool"] } } }];
		const start = pi.handlers.get("session_start");
		assert.ok(start);
		await start({}, context);
		assert.deepEqual(pi.activeTools, ["read"]);
		assert.equal(pi.notifications.length, 0);
		await deferred.flush();
		assert.deepEqual(pi.activeTools, ["read"]);
		assert.match(pi.notifications.at(-1)?.message ?? "", /Mode delegator: omitted unavailable tools: missing_tool/);
		assert.match(String((pi.entries.at(-1)?.data as any)?.message), /Mode delegator: omitted unavailable tools: missing_tool/);
	} finally {
		if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prior;
	}
});

test("prompt projection failure appends an entry and notifies", async () => {
	const agent = mkdtempSync(join(tmpdir(), "pi-modes-load-"));
	mkdirSync(join(agent, "modes"));
	writeFileSync(join(agent, "modes", "replace.md"), "---\nname: replace\nsystemPromptMode: replace\n---\nMODE");
	const prior = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agent;
	try {
		const { registerPiModes } = await import("../src/index.ts");
		const pi = createFakePi();
		const deferred = deferredScheduler();
		registerPiModes(pi as any, deferred.scheduler);
		const context = sessionContext(pi.notifications);
		const start = pi.handlers.get("session_start");
		assert.ok(start);
		(context.sessionManager as any).getBranch = () => [{ type: "custom", customType: "pi-modes-state", data: { version: 1, activeModeName: "replace", baseline: { thinking: "medium", tools: [] } } }];
		await start({}, context);
		await deferred.flush();
		const before = pi.handlers.get("before_agent_start");
		assert.ok(before);
		await before({ systemPrompt: "BASE", systemPromptOptions: { appendSystemPrompt: "MISSING", cwd: "/tmp" } }, context);
		assert.match(String((pi.entries.at(-1)?.data as any)?.message), /Cannot locate/);
		assert.match(pi.notifications.at(-1)?.message ?? "", /Cannot locate/);
	} finally {
		if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prior;
	}
});
