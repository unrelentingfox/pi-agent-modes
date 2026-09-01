import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { warn } from "./warnings.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadModeCatalog } from "./catalog/index.ts";
import { createExternalGuardChain } from "./external-guards/index.ts";
import { registerModeCommand, registerModeShortcuts } from "./interaction/index.ts";
import { createModeController, buildModeSystemPrompt } from "./runtime/index.ts";

export interface DeferredScheduler {
	defer(callback: () => void | Promise<void>): void;
}

const defaultScheduler: DeferredScheduler = {
	defer(callback) {
		setTimeout(callback, 0);
	},
};

export function registerPiModes(pi: ExtensionAPI, scheduler: DeferredScheduler = defaultScheduler): void {
	const catalog = loadModeCatalog(getAgentDir());
	const controller = createModeController(pi, catalog, createExternalGuardChain(pi));
	let restoreGeneration = 0;
	registerModeCommand(pi, catalog, controller);
	registerModeShortcuts(pi, catalog, controller);

	const restore = async (ctx: ExtensionContext) => {
		const result = await controller.restore(ctx);
		if (!result.ok) ctx.ui.notify(result.error ?? "pi-modes restore failed", "warning");
	};

	pi.on("session_start", (_event, ctx) => {
		for (const diagnostic of catalog.diagnostics) warn(pi, ctx, diagnostic.message, diagnostic.path);
		const generation = ++restoreGeneration;
		scheduler.defer(async () => {
			if (generation === restoreGeneration) await restore(ctx);
		});
	});
	pi.on("session_tree", async (_event, ctx) => {
		++restoreGeneration;
		await restore(ctx);
	});
	pi.on("session_shutdown", () => {
		++restoreGeneration;
	});
	pi.on("before_agent_start", (event, ctx) => {
		const projection = buildModeSystemPrompt(event, controller.getActiveMode());
		if (projection.warning) warn(pi, ctx, projection.warning);
		return projection.systemPrompt ? { systemPrompt: projection.systemPrompt } : undefined;
	});
}
