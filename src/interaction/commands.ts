import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModeCatalog } from "../types.ts";
import type { ModeController } from "../runtime/index.ts";
import { selectMode } from "./selector.ts";

export function registerModeCommand(pi: ExtensionAPI, catalog: ModeCatalog, controller: ModeController): void {
	pi.registerCommand("pi-mode", {
		description: "Select or inspect a pi-mode",
		getArgumentCompletions: (prefix) => ["off", "status", ...catalog.modes.map((mode) => mode.name)]
			.filter((value) => value.startsWith(prefix))
			.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const value = args.trim();
			if (!value) return selectAndActivate(catalog, controller, ctx);
			if (value === "off") return notifyResult(await controller.clear(ctx), ctx);
			if (value === "status") return ctx.ui.notify(statusText(catalog, controller), "info");
			notifyResult(await controller.activate(value, ctx), ctx);
		},
	});
}

async function selectAndActivate(catalog: ModeCatalog, controller: ModeController, ctx: ExtensionContext): Promise<void> {
	const name = await selectMode(catalog, controller.getActiveMode()?.name, ctx);
	if (!name) return;
	notifyResult(name === "off" ? await controller.clear(ctx) : await controller.activate(name, ctx), ctx);
}

function notifyResult(result: { ok: boolean; error?: string }, ctx: ExtensionContext): void {
	ctx.ui.notify(result.ok ? "pi-mode updated" : result.error ?? "pi-mode transition failed", result.ok ? "info" : "warning");
}

function statusText(catalog: ModeCatalog, controller: ModeController): string {
	const mode = controller.getActiveMode();
	const settings = controller.resolvedSettings();
	const model = settings?.model ? `${settings.model.provider}/${settings.model.id}` : "inherit";
	const effective = settings ? `model: ${model}\nthinking: ${settings.thinking}\ntools: ${settings.tools.join(", ") || "(none)"}` : "settings: baseline";
	const exclusions = mode?.excludeTools.length ? `excluded: ${mode.excludeTools.join(", ")}` : "";
	const diagnostics = catalog.diagnostics.map((diagnostic) => `${diagnostic.level}: ${diagnostic.message}`).join("\n");
	return [controller.status(), mode ? `source: ${mode.sourcePath}` : "", effective, exclusions, diagnostics].filter(Boolean).join("\n");
}
