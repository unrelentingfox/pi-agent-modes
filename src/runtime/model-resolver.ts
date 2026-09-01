import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModeBaseline } from "../types.ts";

export interface ModelResolution {
	model?: Model<any>;
	warning?: string;
}

export function resolveModel(selector: string | undefined, baseline: ModeBaseline, ctx: ExtensionContext): ModelResolution {
	const baselineModel = baseline.model ? ctx.modelRegistry.find(baseline.model.provider, baseline.model.id) : undefined;
	if (!selector || selector === "inherit") return { model: baselineModel };
	const slash = selector.indexOf("/");
	if (slash >= 0) {
		const model = ctx.modelRegistry.find(selector.slice(0, slash), selector.slice(slash + 1));
		return model ? { model } : fallback(`Configured model ${selector} is not registered`, baselineModel);
	}
	const models = ctx.modelRegistry.getAll().filter((model) => model.id === selector);
	const baselineMatch = baseline.model ? models.find((model) => model.provider === baseline.model!.provider) : undefined;
	if (baselineMatch) return { model: baselineMatch };
	if (models.length === 1) return { model: models[0] };
	if (models.length === 0) return fallback(`Configured model ${selector} is not registered`, baselineModel);
	return fallback(`Configured model ${selector} is ambiguous: ${models.map((model) => `${model.provider}/${model.id}`).join(", ")}`, baselineModel);
}

function fallback(warning: string, baselineModel: Model<any> | undefined): ModelResolution {
	return { model: baselineModel, warning: `${warning}; using the captured baseline model.` };
}
