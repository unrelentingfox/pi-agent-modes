import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ModeDefinition, ModeDiagnostic, ModeParseResult, ModeSystemPromptMode } from "../types.ts";

const ALLOWED_FIELDS = new Set(["name", "description", "tools", "excludeTools", "model", "thinking", "systemPromptMode", "modeOrder", "hotkey"]);

export function parseModeFile(sourcePath: string): ModeParseResult {
	try {
		const content = readFileSync(sourcePath, "utf8");
		if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return failure(sourcePath, "Mode files require a frontmatter block");
		if (!hasClosingFrontmatterDelimiter(content)) return failure(sourcePath, "Mode file has unterminated frontmatter");
		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
		const diagnostics: ModeDiagnostic[] = [];
		for (const field of Object.keys(frontmatter)) if (!ALLOWED_FIELDS.has(field)) diagnostics.push({ level: "warning", path: sourcePath, message: `Unknown frontmatter field: ${field}` });
		const name = optionalString(frontmatter.name, "name", sourcePath, diagnostics) ?? filenameStem(sourcePath);
		if (!name) return failure(sourcePath, "name must not be empty");
		const mode = buildMode({ frontmatter, body, sourcePath, name, diagnostics });
		return { mode, diagnostics };
	} catch (error) {
		return failure(sourcePath, `Cannot parse mode: ${message(error)}`);
	}
}

function hasClosingFrontmatterDelimiter(content: string): boolean {
	const newline = content.startsWith("---\r\n") ? "\r\n" : "\n";
	const delimiter = `${newline}---`;
	const index = content.indexOf(delimiter, newline.length);
	return index >= 0 && (index + delimiter.length === content.length || content.startsWith(newline, index + delimiter.length));
}

function buildMode(input: { frontmatter: Record<string, unknown>; body: string; sourcePath: string; name: string; diagnostics: ModeDiagnostic[] }): ModeDefinition | undefined {
	const { frontmatter, body, sourcePath, name, diagnostics } = input;
	const description = optionalString(frontmatter.description, "description", sourcePath, diagnostics);
	const tools = optionalStringList(frontmatter.tools, "tools", sourcePath, diagnostics);
	const excludeTools = optionalStringList(frontmatter.excludeTools, "excludeTools", sourcePath, diagnostics) ?? [];
	const model = optionalString(frontmatter.model, "model", sourcePath, diagnostics);
	const thinking = optionalString(frontmatter.thinking, "thinking", sourcePath, diagnostics);
	const systemPromptMode = readPromptMode(frontmatter.systemPromptMode, sourcePath, diagnostics);
	const modeOrder = optionalString(frontmatter.modeOrder, "modeOrder", sourcePath, diagnostics);
	const hotkey = optionalString(frontmatter.hotkey, "hotkey", sourcePath, diagnostics);
	if (diagnostics.some((diagnostic) => diagnostic.level === "error")) return undefined;
	return { name, description, tools, excludeTools, model, thinking, systemPromptMode, modeOrder, hotkey, body, sourcePath };
}

function optionalString(value: unknown, field: string, path: string, diagnostics: ModeDiagnostic[]): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") diagnostics.push({ level: "error", path, message: `${field} must be a string` });
	return typeof value === "string" ? value : undefined;
}

function optionalStringList(value: unknown, field: string, path: string, diagnostics: ModeDiagnostic[]): string[] | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
	if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
	diagnostics.push({ level: "error", path, message: `${field} must be a string or an array of strings` });
	return undefined;
}

function readPromptMode(value: unknown, path: string, diagnostics: ModeDiagnostic[]): ModeSystemPromptMode {
	if (value === undefined) return "replace";
	if (value === "append" || value === "replace") return value;
	diagnostics.push({ level: "error", path, message: "systemPromptMode must be append or replace" });
	return "replace";
}

function filenameStem(path: string): string {
	return basename(path, extname(path));
}

function failure(path: string, message: string): ModeParseResult {
	return { diagnostics: [{ level: "error", path, message }] };
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
