import assert from "node:assert/strict";
import test from "node:test";
import { createPlannotatorGuard } from "../src/external-guards/plannotator.ts";

function piWithResponder(respond?: (request: any) => void) {
	let emissions = 0;
	return {
		pi: { events: { emit: (_channel: string, request: any) => { emissions += 1; respond?.(request); } } },
		emissions: () => emissions,
	};
}

test("plannotator guard accepts immediate idle listeners", async () => {
	const fixture = piWithResponder((request) => request.respond({ status: "handled", result: { phase: "idle" } }));
	const started = Date.now();
	assert.equal((await createPlannotatorGuard(fixture.pi as any).check({} as any)).allowed, true);
	assert.ok(Date.now() - started < 100);
	assert.equal(fixture.emissions(), 1);
});

test("plannotator guard caches absent listeners after a bounded timeout", async () => {
	const fixture = piWithResponder();
	const guard = createPlannotatorGuard(fixture.pi as any);
	const started = Date.now();
	assert.equal((await guard.check({} as any)).allowed, true);
	const elapsed = Date.now() - started;
	assert.ok(elapsed >= 200 && elapsed < 1_000);
	const cachedStart = Date.now();
	assert.equal((await guard.check({} as any)).allowed, true);
	assert.ok(Date.now() - cachedStart < 50);
	assert.equal(fixture.emissions(), 1);
});
