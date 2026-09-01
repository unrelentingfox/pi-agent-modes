import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ModeTransitionGuard } from "./types.ts";

const REQUEST_CHANNEL = "plannotator:request";
const TIMEOUT_MS = 275;

export function createPlannotatorGuard(pi: ExtensionAPI): ModeTransitionGuard {
	let absent = false;
	return {
		async check() {
			if (absent) return { allowed: true };
			const result = await getPlanPhase(pi);
			if (!result.responded) absent = true;
			return result.phase && result.phase !== "idle"
				? { allowed: false, reason: "Finish or exit Plannotator before changing pi-modes." }
				: { allowed: true };
		},
	};
}

async function getPlanPhase(pi: ExtensionAPI): Promise<{ responded: boolean; phase?: string }> {
	return await new Promise((resolve) => {
		let settled = false;
		const finish = (responded: boolean, phase?: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve({ responded, phase });
		};
		const timeout = setTimeout(() => finish(false), TIMEOUT_MS);
		pi.events.emit(REQUEST_CHANNEL, {
			requestId: randomUUID(),
			action: "plan-mode",
			payload: { mode: "status" },
			respond(response: unknown) {
				finish(true, readPhase(response));
			},
		});
	});
}

function readPhase(response: unknown): string | undefined {
	if (!isRecord(response) || response.status !== "handled" || !isRecord(response.result)) return undefined;
	return typeof response.result.phase === "string" ? response.result.phase : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
