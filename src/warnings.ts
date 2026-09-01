import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export function warn(pi: ExtensionAPI, ctx: ExtensionContext | undefined, message: string, path?: string): void {
	pi.appendEntry("pi-modes-warning", { message, path });
	ctx?.ui.notify(message, "warning");
}
