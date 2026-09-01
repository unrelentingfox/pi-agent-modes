import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, SelectList, Text, decodeKittyPrintable, matchesKey, type SelectItem } from "@earendil-works/pi-tui";
import type { ModeCatalog } from "../types.ts";

const OFF_VALUE = "off";

export async function selectMode(catalog: ModeCatalog, activeModeName: string | undefined, ctx: ExtensionContext): Promise<string | undefined> {
	const items = modeItems(catalog, activeModeName);
	return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
		const container = new Container();
		const queryText = new Text(theme.fg("dim", "filter: "), 0, 0);
		container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Select pi-mode"))));
		container.addChild(queryText);
		const list = new SelectList(items, Math.min(items.length, 10), selectTheme(theme));
		list.onSelect = (item) => done(item.value === OFF_VALUE ? "off" : item.value);
		list.onCancel = () => done(undefined);
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "type to filter • enter select • esc cancel")));
		container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		let query = "";
		const updateQuery = () => {
			queryText.setText(theme.fg("dim", `filter: ${query || "(all)"}`));
			list.setFilter(query);
			list.setSelectedIndex(0);
		};
		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput(data) {
				if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || isNavigation(data)) {
					list.handleInput(data);
				} else if (matchesKey(data, Key.backspace)) {
					query = query.slice(0, -1);
					updateQuery();
				} else {
					const printable = decodeKittyPrintable(data) ?? (isPrintable(data) ? data : undefined);
					if (printable) {
						query += printable;
						updateQuery();
					}
				}
				tui.requestRender();
			},
		};
	});
}

export function modeItems(catalog: ModeCatalog, activeModeName: string | undefined): SelectItem[] {
	return [
		{ value: OFF_VALUE, label: "No active mode", description: "Restore the captured session baseline" },
		...catalog.modes.map((mode) => ({
			value: mode.name,
			label: mode.name === activeModeName ? `${mode.name} (active)` : mode.name,
			description: mode.description,
		})),
	];
}

function selectTheme(theme: ExtensionContext["ui"]["theme"]) {
	return {
		selectedPrefix: (text: string) => theme.fg("accent", text),
		selectedText: (text: string) => theme.fg("accent", text),
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("dim", text),
		noMatch: (text: string) => theme.fg("warning", text),
	};
}

function isNavigation(data: string): boolean {
	return matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.home) || matchesKey(data, Key.end) || matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown);
}

function isPrintable(data: string): boolean {
	return [...data].length === 1 && data >= " " && data !== "\u007f";
}
