import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getNextMode } from "../catalog/index.ts";
import type { ModeTransitionGuard } from "../external-guards/types.ts";
import type { ModeBaseline, ModeCatalog, ModeDefinition, ModeTransitionResult, ResolvedModeSettings } from "../types.ts";
import { resolveModel } from "./model-resolver.ts";
import { captureBaseline, readPersistedModeState, toPersistedModeState } from "./state.ts";
import { warn } from "../warnings.ts";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

export interface ModeController {
	getActiveMode(): ModeDefinition | undefined;
	getBaseline(): ModeBaseline | undefined;
	activate(name: string, ctx: ExtensionContext): Promise<ModeTransitionResult>;
	clear(ctx: ExtensionContext): Promise<ModeTransitionResult>;
	cycle(ctx: ExtensionContext): Promise<ModeTransitionResult>;
	restore(ctx: ExtensionContext): Promise<ModeTransitionResult>;
	status(): string;
	resolvedSettings(): ResolvedModeSettings | undefined;
}

export function createModeController(pi: ExtensionAPI, catalog: ModeCatalog, guards: ModeTransitionGuard): ModeController {
	let activeModeName: string | undefined;
	let baseline: ModeBaseline | undefined;
	let activeSettings: ResolvedModeSettings | undefined;

	const warning = (ctx: ExtensionContext, message: string) => warn(pi, ctx, message);
	const updateStatus = (ctx: ExtensionContext) => ctx.ui.setStatus("pi-modes", activeModeName ? `mode:${activeModeName}` : undefined);
	const persist = () => pi.appendEntry("pi-modes-state", toPersistedModeState(activeModeName, baseline));
	const emitChanged = () => pi.events.emit("pi-modes:changed", { activeModeName, baseline });

	async function activate(name: string, ctx: ExtensionContext): Promise<ModeTransitionResult> {
		if (!ctx.isIdle()) return reject(ctx, "Cannot change pi-modes while the agent is busy.");
		const mode = catalog.byName.get(name);
		if (!mode) return reject(ctx, `Unknown mode ${name}.`);
		const guard = await guards.check(ctx);
		if (!guard.allowed) return reject(ctx, guard.reason ?? "An external extension blocked the mode transition.");
		const candidateBaseline = baseline ?? runtimeSnapshot(pi, ctx);
		let settings: ResolvedModeSettings;
		try {
			settings = resolveModeSettings(mode, candidateBaseline, ctx, pi);
		} catch (error) {
			return reject(ctx, `Mode ${name}: ${message(error)}`);
		}
		const result = await applyTransaction(settings, runtimeSnapshot(pi, ctx), ctx, pi);
		if (!result.ok) return reject(ctx, `Mode ${name}: ${result.error}`);
		warnRecoverableSettings(mode.name, settings.warnings, ctx);
		baseline = candidateBaseline;
		activeModeName = mode.name;
		activeSettings = settings;
		persist();
		updateStatus(ctx);
		emitChanged();
		return { ok: true };
	}

	async function clear(ctx: ExtensionContext): Promise<ModeTransitionResult> {
		if (!activeModeName) {
			updateStatus(ctx);
			return { ok: true };
		}
		if (!ctx.isIdle()) return reject(ctx, "Cannot change pi-modes while the agent is busy.");
		const guard = await guards.check(ctx);
		if (!guard.allowed) return reject(ctx, guard.reason ?? "An external extension blocked the mode transition.");
		if (!baseline) return reject(ctx, "Cannot restore pi-modes because its session baseline is missing.");
		const runtime = runtimeSnapshot(pi, ctx);
		const restoredBaseline = safeBaseline(baseline, runtime.thinking);
		if (restoredBaseline.warning) warning(ctx, restoredBaseline.warning);
		const result = await applyBaselineTransaction(restoredBaseline.value, runtime, ctx, pi);
		if (!result.ok) return reject(ctx, `Cannot restore pi-modes baseline: ${result.error}`);
		warnUnavailableTools(activeModeName, result.unavailableTools ?? [], ctx);
		activeModeName = undefined;
		activeSettings = undefined;
		persist();
		updateStatus(ctx);
		emitChanged();
		return { ok: true };
	}

	async function cycle(ctx: ExtensionContext): Promise<ModeTransitionResult> {
		if (catalog.modes.length === 1 && activeModeName === catalog.modes[0]?.name) return clear(ctx);
		const next = getNextMode(catalog, activeModeName);
		return next ? activate(next.name, ctx) : reject(ctx, "No pi-modes are configured.");
	}

	async function restore(ctx: ExtensionContext): Promise<ModeTransitionResult> {
		const target = readPersistedModeState(ctx.sessionManager.getBranch());
		const previousBaseline = baseline;
		if (!target?.activeModeName) {
			if (activeModeName && previousBaseline) {
				const runtime = runtimeSnapshot(pi, ctx);
				const restoredBaseline = safeBaseline(previousBaseline, runtime.thinking);
				if (restoredBaseline.warning) warning(ctx, restoredBaseline.warning);
				const result = await applyBaselineTransaction(restoredBaseline.value, runtime, ctx, pi);
				if (!result.ok) return reject(ctx, `Cannot restore pre-mode branch: ${result.error}`);
				warnUnavailableTools(activeModeName, result.unavailableTools ?? [], ctx);
			}
			activeModeName = undefined;
			baseline = undefined;
			activeSettings = undefined;
			updateStatus(ctx);
			emitChanged();
			return { ok: true };
		}
		const mode = catalog.byName.get(target.activeModeName);
		if (!mode) return restoreMissingMode(target.activeModeName, target.baseline, ctx);
		if (!target.baseline) return reject(ctx, `Saved mode ${mode.name} has no baseline and was not restored.`);
		const runtime = runtimeSnapshot(pi, ctx);
		const restoredBaseline = safeBaseline(target.baseline, runtime.thinking);
		if (restoredBaseline.warning) warning(ctx, restoredBaseline.warning);
		const guard = await guards.check(ctx);
		if (!guard.allowed) return reject(ctx, guard.reason ?? "An external extension blocked the mode transition.");
		let settings: ResolvedModeSettings;
		try {
			settings = resolveModeSettings(mode, restoredBaseline.value, ctx, pi);
		} catch (error) {
			return reject(ctx, `Cannot restore mode ${mode.name}: ${message(error)}`);
		}
		const result = await applyTransaction(settings, runtime, ctx, pi);
		if (!result.ok) return reject(ctx, `Cannot restore mode ${mode.name}: ${result.error}`);
		warnRecoverableSettings(mode.name, settings.warnings, ctx);
		activeModeName = mode.name;
		baseline = target.baseline;
		activeSettings = settings;
		updateStatus(ctx);
		emitChanged();
		return { ok: true };
	}

	async function restoreMissingMode(name: string, targetBaseline: ModeBaseline | undefined, ctx: ExtensionContext): Promise<ModeTransitionResult> {
		if (targetBaseline) {
			const runtime = runtimeSnapshot(pi, ctx);
			const restoredBaseline = safeBaseline(targetBaseline, runtime.thinking);
			if (restoredBaseline.warning) warning(ctx, restoredBaseline.warning);
			const result = await applyBaselineTransaction(restoredBaseline.value, runtime, ctx, pi);
			if (!result.ok) return reject(ctx, `Saved mode ${name} is unavailable and baseline restoration failed: ${result.error}`);
			warnUnavailableTools(name, result.unavailableTools ?? [], ctx);
		}
		activeModeName = undefined;
		baseline = targetBaseline;
		activeSettings = undefined;
		warning(ctx, `Saved mode ${name} no longer exists; restored the saved baseline.`);
		updateStatus(ctx);
		emitChanged();
		return { ok: true };
	}

	function warnRecoverableSettings(modeName: string, warnings: string[], ctx: ExtensionContext): void {
		for (const detail of warnings) warning(ctx, `Mode ${modeName}: ${detail}`);
	}

	function warnUnavailableTools(modeName: string, unavailableTools: string[], ctx: ExtensionContext): void {
		if (unavailableTools.length > 0) warnRecoverableSettings(modeName, [`omitted unavailable tools: ${unavailableTools.join(", ")}.`], ctx);
	}

	function reject(ctx: ExtensionContext, error: string): ModeTransitionResult {
		warning(ctx, error);
		return { ok: false, error };
	}

	return {
		getActiveMode: () => activeModeName ? catalog.byName.get(activeModeName) : undefined,
		getBaseline: () => baseline,
		activate,
		clear,
		cycle,
		restore,
		status: () => activeModeName ? `mode:${activeModeName}` : "No active mode",
		resolvedSettings: () => activeSettings,
	};
}

export function resolveModeSettings(mode: ModeDefinition, baseline: ModeBaseline, ctx: ExtensionContext, pi: ExtensionAPI): ResolvedModeSettings {
	const requestedTools = mode.tools === undefined ? baseline.tools : mode.tools;
	const candidates = requestedTools.filter((tool) => !mode.excludeTools.includes(tool));
	const { tools, unavailableTools } = availableTools(candidates, pi);
	const requestedThinking = mode.thinking ?? baseline.thinking;
	const thinking = THINKING_LEVELS.has(requestedThinking) ? requestedThinking : baseline.thinking;
	const modelResolution = resolveModel(mode.model, baseline, ctx);
	const warnings = [
		...(unavailableTools.length > 0 ? [`omitted unavailable tools: ${unavailableTools.join(", ")}.`] : []),
		...(requestedThinking === thinking ? [] : [`unsupported thinking level ${requestedThinking}; using the captured baseline thinking level.`]),
		...(modelResolution.warning ? [modelResolution.warning] : []),
	];
	return {
		model: modelResolution.model,
		fallbackModel: mode.model && mode.model !== "inherit" && modelResolution.model && baseline.model
			? ctx.modelRegistry.find(baseline.model.provider, baseline.model.id)
			: undefined,
		configuredModel: mode.model,
		thinking,
		tools,
		warnings,
	};
}

async function applyTransaction(settings: ResolvedModeSettings, rollback: ModeBaseline, ctx: ExtensionContext, pi: ExtensionAPI): Promise<ModeTransitionResult> {
	try {
		await applySettings(settings, pi);
		return { ok: true };
	} catch (applyError) {
		return rollbackTransaction(applyError, rollback, ctx, pi);
	}
}

async function applyBaselineTransaction(target: ModeBaseline, rollback: ModeBaseline, ctx: ExtensionContext, pi: ExtensionAPI): Promise<ModeTransitionResult> {
	try {
		return { ok: true, unavailableTools: await restoreSettings(target, ctx, pi) };
	} catch (applyError) {
		return rollbackTransaction(applyError, rollback, ctx, pi);
	}
}

async function rollbackTransaction(applyError: unknown, rollback: ModeBaseline, ctx: ExtensionContext, pi: ExtensionAPI): Promise<ModeTransitionResult> {
	try {
		await restoreSettings(rollback, ctx, pi);
		return { ok: false, error: message(applyError) };
	} catch (rollbackError) {
		return { ok: false, error: `${message(applyError)}; rollback failed: ${message(rollbackError)}` };
	}
}

function runtimeSnapshot(pi: ExtensionAPI, ctx: ExtensionContext): ModeBaseline {
	return captureBaseline({ model: ctx.model, thinking: pi.getThinkingLevel(), tools: pi.getActiveTools() });
}

function safeBaseline(baseline: ModeBaseline, runtimeThinking: string): { value: ModeBaseline; warning?: string } {
	if (THINKING_LEVELS.has(baseline.thinking)) return { value: baseline };
	const thinking = THINKING_LEVELS.has(runtimeThinking) ? runtimeThinking : "medium";
	return {
		value: { ...baseline, thinking },
		warning: `Saved baseline has unsupported thinking level ${baseline.thinking}; using current runtime thinking ${thinking} without changing saved state.`,
	};
}

async function applySettings(settings: ResolvedModeSettings, pi: ExtensionAPI): Promise<void> {
	if (settings.model && !await pi.setModel(settings.model)) {
		if (!settings.fallbackModel || !await pi.setModel(settings.fallbackModel)) throw new Error("Model authentication is unavailable");
		settings.model = settings.fallbackModel;
		settings.warnings.push(`Configured model ${settings.configuredModel} is unavailable; using the captured baseline model.`);
	}
	pi.setThinkingLevel(settings.thinking as ThinkingLevel);
	pi.setActiveTools(settings.tools);
}

async function restoreSettings(baseline: ModeBaseline, ctx: ExtensionContext, pi: ExtensionAPI): Promise<string[]> {
	if (baseline.model) {
		const model = ctx.modelRegistry.find(baseline.model.provider, baseline.model.id);
		if (!model) throw new Error(`Baseline model ${baseline.model.provider}/${baseline.model.id} is not registered`);
		if (!await pi.setModel(model)) throw new Error("Baseline model authentication is unavailable");
	}
	const { tools, unavailableTools } = availableTools(baseline.tools, pi);
	pi.setThinkingLevel(baseline.thinking as ThinkingLevel);
	pi.setActiveTools(tools);
	return unavailableTools;
}

function availableTools(requestedTools: string[], pi: ExtensionAPI): { tools: string[]; unavailableTools: string[] } {
	const allTools = new Set(pi.getAllTools().map((tool) => tool.name));
	return {
		tools: requestedTools.filter((tool) => allTools.has(tool)),
		unavailableTools: requestedTools.filter((tool) => !allTools.has(tool)),
	};
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
