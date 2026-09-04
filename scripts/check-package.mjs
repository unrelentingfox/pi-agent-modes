import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const [{ files }] = JSON.parse(output);
const paths = files.map(({ path }) => path);

for (const required of ["LICENSE", "README.md", "CHANGELOG.md", "index.ts", "package.json", "schemas/modes.schema.json"]) {
	assert(paths.includes(required), `Missing package file: ${required}`);
}

for (const path of paths) {
	assert(!path.startsWith("test/"), `Tests must not ship: ${path}`);
	assert(!path.startsWith("node_modules/"), `Dependencies must not ship: ${path}`);
	assert(!path.startsWith(".github/"), `GitHub metadata must not ship: ${path}`);
}

console.log(`Validated ${paths.length} package files.`);
