import { realpathSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { ModeDiagnostic } from "../types.ts";

export function discoverModeFiles(path: string, diagnostics: ModeDiagnostic[]): string[] {
	try {
		const stat = statSync(path);
		if (stat.isFile()) return isModeFile(path) ? [realpathSync(path)] : [];
		if (!stat.isDirectory()) return [];
		return discoverDirectory(path, diagnostics);
	} catch (error) {
		if (isMissing(error)) return [];
		diagnostics.push({ level: "warning", path, message: `Cannot read mode path: ${message(error)}` });
		return [];
	}
}

function discoverDirectory(directory: string, diagnostics: ModeDiagnostic[]): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compare(left.name, right.name))) {
		const path = join(directory, entry.name);
		try {
			if (entry.isSymbolicLink()) {
				if (statSync(path).isFile() && isModeFile(path)) files.push(realpathSync(path));
				continue;
			}
			if (entry.isDirectory()) files.push(...discoverDirectory(path, diagnostics));
			else if (entry.isFile() && isModeFile(path)) files.push(realpathSync(path));
		} catch (error) {
			diagnostics.push({ level: "warning", path, message: `Cannot inspect mode path: ${message(error)}` });
		}
	}
	return files;
}

function isModeFile(path: string): boolean {
	return extname(path) === ".md" && !basename(path).endsWith(".chain.md");
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
