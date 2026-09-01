import { statSync } from "node:fs";
import { resolve } from "node:path";
import { loadModesConfig, expandModePath } from "./config.ts";
import { discoverModeFiles } from "./discovery.ts";
import { parseModeFile } from "./parser.ts";
import type { ModeCatalog, ModeDefinition } from "../types.ts";

export { expandModePath, loadModesConfig } from "./config.ts";
export { discoverModeFiles } from "./discovery.ts";
export { parseModeFile } from "./parser.ts";

export function loadModeCatalog(agentDir: string): ModeCatalog {
	const { config, diagnostics } = loadModesConfig(agentDir);
	const defaultModesPath = resolve(agentDir, "modes");
	const sources = [defaultModesPath, ...config.modePaths.map((path) => expandModePath(path, agentDir))];
	const seenPaths = new Set<string>();
	const byName = new Map<string, ModeDefinition>();
	for (const source of sources) {
		if (source !== defaultModesPath && !exists(source)) {
			diagnostics.push({ level: "warning", path: source, message: "Configured mode path does not exist." });
			continue;
		}
		for (const path of discoverModeFiles(source, diagnostics)) {
			if (seenPaths.has(path)) continue;
			seenPaths.add(path);
			const parsed = parseModeFile(path);
			diagnostics.push(...parsed.diagnostics);
			if (!parsed.mode) continue;
			if (isReservedModeName(parsed.mode.name)) {
				diagnostics.push({ level: "error", path, message: `Mode name ${parsed.mode.name} is reserved.` });
				continue;
			}
			const previous = byName.get(parsed.mode.name);
			if (previous) diagnostics.push({ level: "warning", path, message: `Mode ${parsed.mode.name} overrides ${previous.sourcePath}` });
			byName.set(parsed.mode.name, parsed.mode);
		}
	}
	const modes = [...byName.values()].sort(compareModes);
	return { modes, byName, cycleHotkey: config.cycleHotkey, diagnostics };
}

export function findMode(catalog: ModeCatalog, name: string): ModeDefinition | undefined {
	return catalog.byName.get(name);
}

export function getNextMode(catalog: ModeCatalog, activeName: string | undefined): ModeDefinition | undefined {
	if (catalog.modes.length === 0) return undefined;
	const index = catalog.modes.findIndex((mode) => mode.name === activeName);
	return catalog.modes[(index + 1) % catalog.modes.length];
}

function exists(path: string): boolean {
	try {
		return statSync(path).isFile() || statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isReservedModeName(name: string): boolean {
	return name === "off" || name === "status";
}

function compareModes(left: ModeDefinition, right: ModeDefinition): number {
	const leftKey = `${left.modeOrder ?? ""}${left.name}${left.sourcePath}`;
	const rightKey = `${right.modeOrder ?? ""}${right.name}${right.sourcePath}`;
	return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
