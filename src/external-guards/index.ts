import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPlannotatorGuard } from "./plannotator.ts";
import type { GuardResult, ModeTransitionGuard } from "./types.ts";

export type { GuardResult, ModeTransitionGuard } from "./types.ts";
export { createPlannotatorGuard } from "./plannotator.ts";

export function createExternalGuardChain(pi: ExtensionAPI): ModeTransitionGuard {
	return createGuardChain([createPlannotatorGuard(pi)]);
}

export function createGuardChain(guards: ModeTransitionGuard[]): ModeTransitionGuard {
	return {
		async check(ctx: ExtensionContext): Promise<GuardResult> {
			for (const guard of guards) {
				const result = await guard.check(ctx);
				if (!result.allowed) return result;
			}
			return { allowed: true };
		},
	};
}
