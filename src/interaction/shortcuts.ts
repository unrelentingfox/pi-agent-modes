import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, type KeyId } from "@earendil-works/pi-tui";
import type { ModeCatalog, ModeDiagnostic } from "../types.ts";
import type { ModeController } from "../runtime/index.ts";

export function registerModeShortcuts(pi: ExtensionAPI, catalog: ModeCatalog, controller: ModeController): void {
	const cycle = validateHotkey(catalog.cycleHotkey, "cycle hotkey", catalog.diagnostics);
	if (cycle) pi.registerShortcut(cycle, { description: "Cycle pi-modes", handler: (ctx) => run(controller.cycle(ctx), ctx) });
	const registered = new Set(cycle ? [cycle] : []);
	for (const mode of catalog.modes) {
		const hotkey = validateHotkey(mode.hotkey, `mode ${mode.name}`, catalog.diagnostics);
		if (!hotkey) continue;
		if (registered.has(hotkey)) {
			catalog.diagnostics.push(collision(hotkey, mode.name));
			continue;
		}
		registered.add(hotkey);
		pi.registerShortcut(hotkey, { description: `Activate pi-mode ${mode.name}`, handler: (ctx) => run(controller.activate(mode.name, ctx), ctx) });
	}
}

export function validateHotkey(value: string | undefined, source: string, diagnostics: ModeDiagnostic[]): KeyId | undefined {
	if (value === undefined) return undefined;
	if (isKeyId(value)) return value;
	diagnostics.push({ level: "warning", message: `Skipped invalid hotkey ${JSON.stringify(value)} for ${source}.` });
	return undefined;
}

async function run(result: Promise<{ ok: boolean; error?: string }>, ctx: ExtensionContext): Promise<void> {
	const transition = await result;
	ctx.ui.notify(transition.ok ? "pi-mode updated" : transition.error ?? "pi-mode transition failed", transition.ok ? "info" : "warning");
}

function isKeyId(value: string): value is KeyId {
	const keyValues = Object.values(Key).filter((key) => typeof key === "string") as string[];
	const baseKeys = [...keyValues, ..."abcdefghijklmnopqrstuvwxyz0123456789"];
	if (baseKeys.includes(value)) return true;
	const parts = value.split("+");
	if (parts.length < 2 || new Set(parts).size !== parts.length) return false;
	const base = parts.at(-1);
	const modifiers = parts.slice(0, -1);
	return base !== undefined && baseKeys.includes(base) && modifiers.every((modifier) => ["ctrl", "shift", "alt", "super"].includes(modifier));
}

function collision(hotkey: string, name: string): ModeDiagnostic {
	return { level: "warning", message: `Skipped hotkey ${hotkey} for ${name}; the cycle binding wins.` };
}
