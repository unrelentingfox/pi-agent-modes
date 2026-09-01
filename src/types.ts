import type { Model } from "@earendil-works/pi-ai";

export type ModeSystemPromptMode = "append" | "replace";

export interface ModeDefinition {
	name: string;
	description?: string;
	tools?: string[];
	excludeTools: string[];
	model?: string;
	thinking?: string;
	systemPromptMode: ModeSystemPromptMode;
	modeOrder?: string;
	hotkey?: string;
	body: string;
	sourcePath: string;
}

export interface ModeDiagnostic {
	level: "warning" | "error";
	message: string;
	path?: string;
}

export interface ModeCatalog {
	modes: ModeDefinition[];
	byName: Map<string, ModeDefinition>;
	cycleHotkey?: string;
	diagnostics: ModeDiagnostic[];
}

export interface ModeBaseline {
	model?: { provider: string; id: string };
	thinking: string;
	tools: string[];
}

export interface PersistedModeState {
	version: 1;
	activeModeName?: string;
	baseline?: ModeBaseline;
}

export interface ResolvedModeSettings {
	model?: Model<any>;
	fallbackModel?: Model<any>;
	configuredModel?: string;
	thinking: string;
	tools: string[];
	warnings: string[];
}

export interface ModeParseResult {
	mode?: ModeDefinition;
	diagnostics: ModeDiagnostic[];
}

export interface ModeTransitionResult {
	ok: boolean;
	error?: string;
	unavailableTools?: string[];
}
