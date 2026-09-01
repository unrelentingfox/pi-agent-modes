import type { BeforeAgentStartEvent } from "@earendil-works/pi-coding-agent";
import type { ModeDefinition } from "../types.ts";

const LATER_SECTION_MARKERS = ["\n\n<project_context>", "\n\n<skills", "\nCurrent date:", "\nCurrent working directory:"];

export interface PromptProjection {
	systemPrompt?: string;
	warning?: string;
}

export function buildModeSystemPrompt(event: BeforeAgentStartEvent, mode: ModeDefinition | undefined): PromptProjection {
	if (!mode) return {};
	const append = event.systemPromptOptions.appendSystemPrompt;
	if (mode.systemPromptMode === "append") return { systemPrompt: appendModeBody(event.systemPrompt, append, mode.body) };
	return replaceAppendLayer(event.systemPrompt, append, mode.body);
}

function appendModeBody(systemPrompt: string, append: string | undefined, body: string): string {
	if (!body) return systemPrompt;
	if (!append) return insertAtAppendLayer(systemPrompt, body);
	const index = systemPrompt.indexOf(append);
	if (index < 0) return insertAtAppendLayer(systemPrompt, body);
	const end = index + append.length;
	return `${systemPrompt.slice(0, end)}\n\n${body}${systemPrompt.slice(end)}`;
}

function replaceAppendLayer(systemPrompt: string, append: string | undefined, body: string): PromptProjection {
	if (!append) return { systemPrompt: insertAtAppendLayer(systemPrompt, body) };
	const index = systemPrompt.indexOf(append);
	if (index < 0) return { warning: "Cannot locate Pi's append-system-prompt layer; mode prompt was not changed." };
	return { systemPrompt: `${systemPrompt.slice(0, index)}${body}${systemPrompt.slice(index + append.length)}` };
}

function insertAtAppendLayer(systemPrompt: string, body: string): string {
	if (!body) return systemPrompt;
	const indexes = LATER_SECTION_MARKERS.map((marker) => systemPrompt.indexOf(marker)).filter((index) => index >= 0);
	const index = indexes.length > 0 ? Math.min(...indexes) : systemPrompt.length;
	return `${systemPrompt.slice(0, index)}\n\n${body}${systemPrompt.slice(index)}`;
}
