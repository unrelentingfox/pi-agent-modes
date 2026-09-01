import assert from "node:assert/strict";
import test from "node:test";
import { registerModeShortcuts, validateHotkey } from "../src/interaction/shortcuts.ts";
import { modeItems, selectMode } from "../src/interaction/selector.ts";
import type { ModeCatalog } from "../src/types.ts";

const catalog: ModeCatalog = {
	cycleHotkey: "ctrl+shift+m", diagnostics: [], byName: new Map(),
	modes: [
		{ name: "work", excludeTools: [], systemPromptMode: "replace", body: "", sourcePath: "/work.md", hotkey: "ctrl+w" },
		{ name: "worker", excludeTools: [], systemPromptMode: "replace", body: "", sourcePath: "/worker.md" },
		{ name: "duplicate", excludeTools: [], systemPromptMode: "replace", body: "", sourcePath: "/duplicate.md", hotkey: "ctrl+shift+m" },
	],
};
for (const mode of catalog.modes) catalog.byName.set(mode.name, mode);

test("registers cycle and direct shortcuts and reserves the cycle binding", () => {
	const registered: string[] = [];
	const pi = { registerShortcut: (key: string) => registered.push(key) };
	const controller = { cycle: async () => ({ ok: true }), activate: async () => ({ ok: true }) };
	registerModeShortcuts(pi as any, catalog, controller as any);
	assert.deepEqual(registered, ["ctrl+shift+m", "ctrl+w"]);
	assert.match(catalog.diagnostics.at(-1)?.message ?? "", /cycle binding wins/);
});

test("registers shift+tab as a cycle shortcut", () => {
	const registered: string[] = [];
	const pi = { registerShortcut: (key: string) => registered.push(key) };
	const controller = { cycle: async () => ({ ok: true }), activate: async () => ({ ok: true }) };
	const shiftTabCatalog: ModeCatalog = { ...catalog, cycleHotkey: "shift+tab", diagnostics: [] };
	registerModeShortcuts(pi as any, shiftTabCatalog, controller as any);
	assert.equal(registered[0], "shift+tab");
	assert.deepEqual(shiftTabCatalog.diagnostics, []);
});

test("rejects malformed hotkeys before Pi registration", () => {
	const diagnostics: any[] = [];
	assert.equal(validateHotkey("ctrl+not-a-key", "mode worker", diagnostics), undefined);
	assert.match(diagnostics[0]?.message ?? "", /Skipped invalid hotkey/);
});

test("selector options use stable values where a name prefixes another", () => {
	const items = modeItems(catalog, "work");
	assert.equal(items[0]?.label, "No active mode");
	assert.equal(items.find((item) => item.label === "work (active)")?.value, "work");
	assert.equal(items.find((item) => item.label === "worker")?.value, "worker");
});

test("selector filters through query input and returns exact identities", async () => {
	const worker = await selectWithInput(["w", "o", "r", "k", "e", "r", "\r"]);
	assert.equal(worker, "worker");
	const off = await selectWithInput(["o", "f", "f", "\r"]);
	assert.equal(off, "off");
});

async function selectWithInput(inputs: string[]): Promise<string | undefined> {
	const ctx = { ui: { custom: async (factory: any) => {
		let selected: string | undefined;
		const component = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, {}, (value: string) => { selected = value; });
		for (const input of inputs) component.handleInput(input);
		return selected;
	} } };
	return selectMode(catalog, undefined, ctx as any);
}
