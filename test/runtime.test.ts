import assert from "node:assert/strict";
import test from "node:test";
import { createModeController, resolveModeSettings } from "../src/runtime/controller.ts";
import { buildModeSystemPrompt } from "../src/runtime/prompt.ts";
import { readPersistedModeState } from "../src/runtime/state.ts";
import type { ModeCatalog, ModeDefinition } from "../src/types.ts";

const baseline = { model: { provider: "a", id: "one" }, thinking: "medium", tools: ["read", "write"] };
const appendMode: ModeDefinition = { name: "append", excludeTools: [], systemPromptMode: "append", body: "MODE", sourcePath: "/mode.md" };
const replaceMode: ModeDefinition = { ...appendMode, name: "replace", systemPromptMode: "replace" };
const prompt = "BASE\n\nAPPEND\n\n<project_context>\n\nPROJECT\n</project_context>\n\n<skills>SKILLS</skills>\nCurrent date: today";
const event = { systemPrompt: prompt, systemPromptOptions: { appendSystemPrompt: "APPEND", cwd: "/tmp" } } as any;

test("append and replace preserve Pi's real project-context and unrelated layers", () => {
	assert.equal(buildModeSystemPrompt(event, appendMode).systemPrompt, prompt.replace("APPEND", "APPEND\n\nMODE"));
	assert.equal(buildModeSystemPrompt(event, replaceMode).systemPrompt, prompt.replace("APPEND", "MODE"));
	assert.equal(buildModeSystemPrompt(event, { ...replaceMode, body: "" }).systemPrompt, prompt.replace("APPEND", ""));
});

test("uses the pre-project-context append layer when Pi has no append prompt", () => {
	const withoutAppend = { ...event, systemPrompt: prompt.replace("\n\nAPPEND", ""), systemPromptOptions: { cwd: "/tmp" } };
	assert.equal(buildModeSystemPrompt(withoutAppend, appendMode).systemPrompt, withoutAppend.systemPrompt.replace("\n\n<project_context>", "\n\nMODE\n\n<project_context>"));
	assert.equal(buildModeSystemPrompt(withoutAppend, replaceMode).systemPrompt, withoutAppend.systemPrompt.replace("\n\n<project_context>", "\n\nMODE\n\n<project_context>"));
});

test("replace fails closed when Pi's declared append layer is absent", () => {
	const result = buildModeSystemPrompt({ ...event, systemPrompt: prompt.replace("APPEND", "OTHER") }, replaceMode);
	assert.equal(result.systemPrompt, undefined);
	assert.match(result.warning ?? "", /Cannot locate/);
});

test("inserts before skills and date when project context is absent", () => {
	const noProject = { systemPrompt: "BASE\n\n<skills>SKILLS</skills>\nCurrent date: today\nCurrent working directory: /tmp", systemPromptOptions: { cwd: "/tmp" } } as any;
	assert.equal(buildModeSystemPrompt(noProject, appendMode).systemPrompt, "BASE\n\nMODE\n\n<skills>SKILLS</skills>\nCurrent date: today\nCurrent working directory: /tmp");
});

test("mode settings use baseline tools, honor explicit empty tools, and exclusions win", () => {
	const context = { modelRegistry: { find: (provider: string, id: string) => ({ provider, id }), getAll: () => [{ provider: "a", id: "one" }] } };
	const pi = { getAllTools: () => [{ name: "read" }, { name: "write" }, { name: "edit" }] };
	assert.deepEqual(resolveModeSettings({ ...appendMode, tools: undefined, excludeTools: ["write"] }, baseline, context as any, pi as any).tools, ["read"]);
	assert.deepEqual(resolveModeSettings({ ...appendMode, tools: [], excludeTools: [] }, baseline, context as any, pi as any).tools, []);
});

test("mode settings omit unavailable tools and fall back for invalid configured model and thinking", () => {
	const context = { modelRegistry: { find: (provider: string, id: string) => provider === "a" && id === "one" ? { provider, id } : undefined, getAll: () => [{ provider: "x", id: "same" }, { provider: "y", id: "same" }] } };
	const pi = { getAllTools: () => [{ name: "read" }] };
	const settings = resolveModeSettings({ ...appendMode, tools: ["read", "unknown"], model: "same", thinking: "unsupported" }, baseline, context as any, pi as any);
	assert.deepEqual(settings.tools, ["read"]);
	assert.deepEqual(settings.model, baseline.model);
	assert.equal(settings.thinking, baseline.thinking);
	assert.deepEqual(settings.warnings, [
		"omitted unavailable tools: unknown.",
		"unsupported thinking level unsupported; using the captured baseline thinking level.",
		"Configured model same is ambiguous: x/same, y/same; using the captured baseline model.",
	]);
});

test("cycles a single mode between the baseline and the configured mode", async () => {
	const delegator = { ...appendMode, name: "delegator", tools: ["read"] };
	const { controller, ctx, pi } = controllerFixture(undefined, undefined, undefined, delegator);
	assert.equal((await controller.cycle(ctx)).ok, true);
	assert.equal(controller.getActiveMode()?.name, "delegator");
	assert.deepEqual(pi.activeTools, ["read"]);
	assert.equal((await controller.cycle(ctx)).ok, true);
	assert.equal(controller.getActiveMode(), undefined);
	assert.deepEqual(pi.activeTools, baseline.tools);
});

test("configured model authentication failure falls back to the baseline model", async () => {
	const configured = { provider: "b", id: "configured" };
	const fallback = { provider: "a", id: "one" };
	const worker = { ...appendMode, name: "worker", model: "b/configured" };
	const { controller, ctx, pi, entries, notifications } = controllerFixture(undefined, undefined, undefined, worker);
	ctx.modelRegistry.find = (provider: string, id: string) => provider === "b" ? configured : fallback;
	ctx.modelRegistry.getAll = () => [configured, fallback];
	pi.setModel = async (model: { provider: string }) => model.provider !== "b";
	assert.equal((await controller.activate("worker", ctx)).ok, true);
	assert.deepEqual(controller.resolvedSettings()?.model, fallback);
	assert.match(entries.find((entry: any) => entry.type === "pi-modes-warning")?.data.message ?? "", /Configured model b\/configured is unavailable/);
	assert.match(notifications.at(-1)?.message ?? "", /Configured model b\/configured is unavailable/);
});

test("reads the latest valid persisted branch state", () => {
	const state = readPersistedModeState([
		{ type: "custom", customType: "pi-modes-state", data: { version: 1, activeModeName: "old", baseline } },
		{ type: "custom", customType: "pi-modes-state", data: { version: 1, activeModeName: "new", baseline } },
	] as any);
	assert.equal(state?.activeModeName, "new");
});

test("restore returns an active session to the previous baseline for a pre-mode branch", async () => {
	const { controller, ctx, pi, events } = controllerFixture({ activeModeName: "worker", baseline });
	assert.equal((await controller.restore(ctx)).ok, true);
	ctx.sessionManager.getBranch = () => [];
	assert.equal((await controller.restore(ctx)).ok, true);
	assert.equal(controller.getActiveMode(), undefined);
	assert.deepEqual(pi.activeTools, baseline.tools);
	assert.equal(events.length, 2);
});

test("explicit unavailable tools warn and activate with available tools", async () => {
	const mode = { ...appendMode, name: "worker", tools: ["read", "missing"] };
	const { controller, ctx, pi, entries, notifications } = controllerFixture(undefined, undefined, undefined, mode);
	assert.equal((await controller.activate("worker", ctx)).ok, true);
	assert.deepEqual(pi.activeTools, ["read"]);
	assert.deepEqual(controller.resolvedSettings()?.tools, ["read"]);
	assert.match(entries.find((entry: any) => entry.type === "pi-modes-warning")?.data.message ?? "", /Mode worker: omitted unavailable tools: missing/);
	assert.match(notifications.at(-1)?.message ?? "", /Mode worker: omitted unavailable tools: missing/);
});

test("all unavailable explicit tools activate an empty active set", async () => {
	const mode = { ...appendMode, name: "worker", tools: ["missing-one", "missing-two"] };
	const { controller, ctx, pi, entries } = controllerFixture(undefined, undefined, undefined, mode);
	assert.equal((await controller.activate("worker", ctx)).ok, true);
	assert.deepEqual(pi.activeTools, []);
	assert.deepEqual(controller.resolvedSettings()?.tools, []);
	assert.match(entries.find((entry: any) => entry.type === "pi-modes-warning")?.data.message ?? "", /missing-one, missing-two/);
});

test("restore missing saved mode restores its baseline without persisting target history", async () => {
	const targetBaseline = { ...baseline, tools: ["read"] };
	const { controller, ctx, pi, entries, events, notifications } = controllerFixture({ activeModeName: "gone", baseline: targetBaseline });
	assert.equal((await controller.restore(ctx)).ok, true);
	assert.equal(controller.getActiveMode(), undefined);
	assert.deepEqual(pi.activeTools, targetBaseline.tools);
	assert.equal(entries.filter((entry: any) => entry.type === "pi-modes-state").length, 0);
	assert.match(entries.at(-1)?.data.message ?? "", /no longer exists/);
	assert.match(notifications.at(-1)?.message ?? "", /no longer exists/);
	assert.equal(events.length, 1);
});

test("invalid persisted baseline thinking falls back without eroding saved state", async () => {
	const targetBaseline = { ...baseline, thinking: "invalid" };
	const mode = { ...appendMode, name: "worker", tools: undefined };
	const { controller, ctx, pi, entries, notifications } = controllerFixture({ activeModeName: "worker", baseline: targetBaseline as typeof baseline }, undefined, undefined, mode);
	assert.equal((await controller.restore(ctx)).ok, true);
	assert.equal(pi.thinking, "medium");
	assert.equal(controller.getBaseline()?.thinking, "invalid");
	assert.match(entries.at(-1)?.data.message ?? "", /Saved baseline has unsupported thinking level invalid/);
	assert.match(notifications.at(-1)?.message ?? "", /using current runtime thinking medium/);
});

test("persisted baseline tools missing at restore warn without eroding baseline", async () => {
	const targetBaseline = { ...baseline, tools: ["read", "missing"] };
	const mode = { ...appendMode, name: "worker", tools: undefined };
	const { controller, ctx, pi, entries, notifications, statuses } = controllerFixture({ activeModeName: "worker", baseline: targetBaseline }, undefined, undefined, mode);
	assert.equal((await controller.restore(ctx)).ok, true);
	assert.equal(controller.getActiveMode()?.name, "worker");
	assert.deepEqual(pi.activeTools, ["read"]);
	assert.deepEqual(controller.resolvedSettings()?.tools, ["read"]);
	assert.deepEqual(controller.getBaseline()?.tools, ["read", "missing"]);
	assert.equal(statuses.at(-1), "mode:worker");
	assert.match(entries.at(-1)?.data.message ?? "", /Mode worker: omitted unavailable tools: missing/);
	assert.match(notifications.at(-1)?.message ?? "", /Mode worker: omitted unavailable tools: missing/);
});

test("guard veto leaves prior active state coherent", async () => {
	const { controller, ctx } = controllerFixture({ activeModeName: "worker", baseline }, { allowed: false, reason: "planning" });
	assert.equal((await controller.restore(ctx)).ok, false);
	assert.equal(controller.getActiveMode(), undefined);
	assert.equal(controller.getBaseline(), undefined);
});

test("transition failure appends a durable warning and notifies the UI", async () => {
	const { controller, ctx, entries, notifications } = controllerFixture(undefined, { allowed: true }, { failTools: true, failRollback: true });
	const result = await controller.activate("worker", ctx);
	assert.equal(result.ok, false);
	assert.match(result.error ?? "", /rollback failed/);
	assert.match(entries.at(-1)?.data.message ?? "", /rollback failed/);
	assert.match(notifications.at(-1)?.message ?? "", /rollback failed/);
	assert.equal(notifications.at(-1)?.type, "warning");
});

function controllerFixture(state?: { activeModeName?: string; baseline?: typeof baseline }, guard: { allowed: boolean; reason?: string } = { allowed: true }, failures = { failTools: false, failRollback: false }, worker: ModeDefinition = { ...appendMode, name: "worker", tools: ["read"] }) {
	const catalog: ModeCatalog = { modes: [worker], byName: new Map([[worker.name, worker]]), diagnostics: [] };
	const entries: any[] = [];
	const events: any[] = [];
	const notifications: Array<{ message: string; type: string }> = [];
	const statuses: Array<string | undefined> = [];
	const pi: any = {
		activeTools: ["read", "write"], thinking: "medium", appendEntry(type: string, data: unknown) { entries.push({ type, data }); }, events: { emit: (_name: string, data: unknown) => events.push(data) },
		getAllTools: () => [{ name: "read" }, { name: "write" }], getActiveTools() { return [...this.activeTools]; }, getThinkingLevel() { return this.thinking; },
		async setModel() { return true; }, setThinkingLevel(value: string) { this.thinking = value; }, setActiveTools(value: string[]) {
			if (failures.failTools && value.length === 1) { failures.failTools = false; throw new Error("apply tools failed"); }
			if (failures.failRollback && value.length === 2) throw new Error("rollback tools failed");
			this.activeTools = [...value];
		},
	};
	const ctx: any = { model: { provider: "a", id: "one" }, isIdle: () => true, modelRegistry: { find: (provider: string, id: string) => ({ provider, id }), getAll: () => [{ provider: "a", id: "one" }] }, ui: { setStatus(_id: string, value: string | undefined) { statuses.push(value); }, notify(message: string, type: string) { notifications.push({ message, type }); } }, sessionManager: { getBranch: () => state ? [{ type: "custom", customType: "pi-modes-state", data: { version: 1, ...state } }] : [] } };
	const controller = createModeController(pi, catalog, { check: async () => guard } as any);
	return { controller, ctx, pi, entries, events, notifications, statuses };
}
