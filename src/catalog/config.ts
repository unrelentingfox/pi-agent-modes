import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { ModeDiagnostic } from "../types.ts";

const CONFIG_FIELDS = new Set(["$schema", "modePaths", "cycleHotkey"]);

export interface ModesConfig {
	modePaths: string[];
	cycleHotkey?: string;
}

export function loadModesConfig(agentDir: string): { config: ModesConfig; diagnostics: ModeDiagnostic[] } {
	const path = resolve(agentDir, "modes.json");
	if (!existsSync(path)) return { config: { modePaths: [] }, diagnostics: [] };
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(value)) throw new Error("Expected an object");
		const diagnostics: ModeDiagnostic[] = [];
		warnUnknownFields(value, path, diagnostics);
		const modePaths = readStringList(value.modePaths, "modePaths", path, diagnostics) ?? [];
		const cycleHotkey = readOptionalString(value.cycleHotkey, "cycleHotkey", path, diagnostics);
		return { config: { modePaths, cycleHotkey }, diagnostics };
	} catch (error) {
		return { config: { modePaths: [] }, diagnostics: [{ level: "error", path, message: `Invalid modes.json: ${message(error)}` }] };
	}
}

export function expandModePath(value: string, agentDir: string): string {
	const expanded = value === "~" || value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : value;
	return isAbsolute(expanded) ? expanded : resolve(agentDir, expanded);
}

function warnUnknownFields(value: Record<string, unknown>, path: string, diagnostics: ModeDiagnostic[]): void {
	for (const field of Object.keys(value)) {
		if (!CONFIG_FIELDS.has(field)) diagnostics.push({ level: "warning", path, message: `Unknown modes.json field: ${field}` });
	}
}

function readStringList(value: unknown, field: string, path: string, diagnostics: ModeDiagnostic[]): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		diagnostics.push({ level: "error", path, message: `${field} must be an array of strings` });
		return undefined;
	}
	return value;
}

function readOptionalString(value: unknown, field: string, path: string, diagnostics: ModeDiagnostic[]): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		diagnostics.push({ level: "error", path, message: `${field} must be a string` });
		return undefined;
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
