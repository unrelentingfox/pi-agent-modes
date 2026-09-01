import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getNextMode, loadModeCatalog } from "../src/catalog/index.ts";

function createAgent(): string {
	const agent = mkdtempSync(join(tmpdir(), "pi-modes-"));
	mkdirSync(join(agent, "modes"));
	return agent;
}

function writeMode(path: string, frontmatter: string, body = ""): void {
	const normalized = frontmatter ? `${frontmatter}\n` : "";
	writeFileSync(path, `---\n${normalized}---\n${body}`);
}

test("loads default and configured paths with later exact-name precedence", () => {
	const agent = createAgent();
	const extra = join(agent, "extra");
	mkdirSync(extra);
	writeMode(join(agent, "modes", "worker.md"), "name: Worker\ntools: read, write", "default");
	writeMode(join(extra, "worker.md"), "name: Worker\ntools: []", "override");
	writeMode(join(extra, "other.md"), "name: worker\nmodeOrder: \"1\"", "case distinct");
	writeFileSync(join(agent, "modes.json"), JSON.stringify({ modePaths: ["extra"] }));

	const catalog = loadModeCatalog(agent);
	assert.equal(catalog.byName.get("Worker")?.body, "override");
	assert.equal(catalog.byName.get("Worker")?.tools?.length, 0);
	assert.equal(catalog.byName.get("worker")?.body, "case distinct");
	assert.match(catalog.diagnostics.map((item) => item.message).join("\n"), /overrides/);
});

test("discovers recursively without directory symlinks or chain files", () => {
	const agent = createAgent();
	const nested = join(agent, "modes", "nested");
	const linked = join(agent, "linked");
	mkdirSync(nested);
	mkdirSync(linked);
	writeMode(join(nested, "nested.md"), "", "nested");
	writeMode(join(agent, "modes", "skip.chain.md"), "", "skip");
	writeMode(join(linked, "linked.md"), "", "linked");
	symlinkSync(linked, join(agent, "modes", "link"));

	const catalog = loadModeCatalog(agent);
	assert.deepEqual(catalog.modes.map((mode) => mode.name), ["nested"]);
});

test("rejects exact reserved names but preserves case-sensitive distinct names", () => {
	const agent = createAgent();
	writeMode(join(agent, "modes", "off.md"), "name: off");
	writeMode(join(agent, "modes", "status.md"), "name: status");
	writeMode(join(agent, "modes", "Off.md"), "name: Off");
	const catalog = loadModeCatalog(agent);
	assert.equal(catalog.byName.has("off"), false);
	assert.equal(catalog.byName.has("status"), false);
	assert.equal(catalog.byName.has("Off"), true);
	assert.match(catalog.diagnostics.map((diagnostic) => diagnostic.message).join("\n"), /reserved/);
});

test("accepts a closing frontmatter delimiter at EOF", () => {
	const agent = createAgent();
	writeFileSync(join(agent, "modes", "eof.md"), "---\nname: eof\n---");

	const catalog = loadModeCatalog(agent);
	assert.equal(catalog.byName.get("eof")?.name, "eof");
	assert.equal(catalog.diagnostics.length, 0);
});

test("warns for unknown config fields and missing configured paths", () => {
	const agent = createAgent();
	writeFileSync(join(agent, "modes.json"), JSON.stringify({ unknown: true, modePaths: ["missing"] }));

	const catalog = loadModeCatalog(agent);
	const diagnostics = catalog.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
	assert.match(diagnostics, /Unknown modes.json field: unknown/);
	assert.match(diagnostics, /Configured mode path does not exist/);
});

test("keeps the default modes path silently optional", () => {
	const agent = mkdtempSync(join(tmpdir(), "pi-modes-"));
	assert.equal(loadModeCatalog(agent).diagnostics.length, 0);
});

test("isolates invalid and unterminated files and cycles sorted modes", () => {
	const agent = createAgent();
	writeMode(join(agent, "modes", "z.md"), "name: z\nmodeOrder: \"2\"");
	writeMode(join(agent, "modes", "a.md"), "name: a\nmodeOrder: \"1\"");
	writeFileSync(join(agent, "modes", "bad.md"), "body only");
	writeFileSync(join(agent, "modes", "unterminated.md"), "---\nname: unfinished\nbody");

	const catalog = loadModeCatalog(agent);
	assert.deepEqual(catalog.modes.map((mode) => mode.name), ["a", "z"]);
	assert.equal(getNextMode(catalog, "z")?.name, "a");
	assert.equal(catalog.diagnostics.filter((item) => item.level === "error").length, 2);
	assert.match(catalog.diagnostics.map((diagnostic) => diagnostic.message).join("\n"), /unterminated/);
});
