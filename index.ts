import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiModes } from "./src/index.ts";

export default function piModes(pi: ExtensionAPI): void {
	registerPiModes(pi);
}
