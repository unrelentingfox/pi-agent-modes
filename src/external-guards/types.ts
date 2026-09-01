import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface GuardResult {
	allowed: boolean;
	reason?: string;
}

export interface ModeTransitionGuard {
	check(ctx: ExtensionContext): Promise<GuardResult>;
}
