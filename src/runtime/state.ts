import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ModeBaseline, PersistedModeState } from "../types.ts";

export function captureBaseline(input: { model?: { provider: string; id: string }; thinking: string; tools: string[] }): ModeBaseline {
	return { model: input.model ? { provider: input.model.provider, id: input.model.id } : undefined, thinking: input.thinking, tools: [...input.tools] };
}

export function readPersistedModeState(entries: SessionEntry[]): PersistedModeState | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== "pi-modes-state") continue;
		const data = entry.data;
		if (isPersistedModeState(data)) return data;
	}
	return undefined;
}

export function toPersistedModeState(activeModeName: string | undefined, baseline: ModeBaseline | undefined): PersistedModeState {
	return { version: 1, ...(activeModeName ? { activeModeName } : {}), ...(baseline ? { baseline } : {}) };
}

function isPersistedModeState(value: unknown): value is PersistedModeState {
	if (!isRecord(value) || value.version !== 1) return false;
	if (value.activeModeName !== undefined && typeof value.activeModeName !== "string") return false;
	return value.baseline === undefined || isBaseline(value.baseline);
}

function isBaseline(value: unknown): value is ModeBaseline {
	if (!isRecord(value) || typeof value.thinking !== "string" || !isStringArray(value.tools)) return false;
	return value.model === undefined || (isRecord(value.model) && typeof value.model.provider === "string" && typeof value.model.id === "string");
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
