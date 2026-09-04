# Pi Agent Modes

`@unrelentingfox/pi-agent-modes` is a small, configuration-driven
[Pi](https://pi.dev) extension for switching the parent agent between
user-authored operation modes. It provides no default modes and has no runtime
dependency on `pi-subagents` or another Pi extension.

Source: <https://github.com/unrelentingfox/pi-agent-modes>

A mode controls the parent agent's selected model, thinking level, active tool
surface, and append-system-prompt projection. It is **not** a sandbox or a
permission boundary. Pi permission extensions and host policy remain
authoritative.

## Requirements

- Node.js 22.19.0 or newer
- Pi 0.84.4 or newer (0.84.4 is the tested compatibility baseline)

Pi 0.84.4 requires Node 22.19.0, so this package follows the same minimum.
Pi's extension APIs can change before a stable release. Continuous integration
also tests the current Node Long-Term Support (LTS) release, while Pi
compatibility is verified against the pinned development version.

## Install

Install the npm package through Pi:

```bash
pi install npm:@unrelentingfox/pi-agent-modes@0.1.0
```

For local development, install this checkout instead:

```bash
pi install /path/to/pi-agent-modes
```

Pi discovers the extension entry point from `package.json`. Use `/reload` after
installing it in a live session.

## Configuration and discovery

Modes live in `~/.pi/agent/modes/`. This directory is always searched first
and may be empty. Add files or directories in `~/.pi/agent/modes.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/unrelentingfox/pi-agent-modes/v0.1.0/schemas/modes.schema.json",
  "modePaths": ["~/modes", "~/work/modes/reviewer.md"],
  "cycleHotkey": "ctrl+shift+m"
}
```

`modePaths` is additive. Relative paths resolve from Pi's agent directory;
`~` and absolute paths work. Directory search is recursive, excludes
`*.chain.md`, and does not recurse through directory symlinks. Files are
deduplicated by canonical path. Later sources override earlier files with the
same exact, case-sensitive mode name. Changes to modes or hotkeys require
`/reload`; there is no file watcher.

## Mode files

Mode files require frontmatter. The body may be empty.

```markdown
---
name: delegator
description: Coordinate work through subagents
modeOrder: "20"
hotkey: ctrl+alt+d
tools:
  - read
  - grep
  - find
  - ls
  - subagent
excludeTools: write, edit
model: alias/gpt-high
thinking: high
systemPromptMode: replace
---

You are the parent orchestrator. Delegate non-trivial work and synthesize the
result in this session.
```

Supported fields:

| Field | Meaning |
| --- | --- |
| `name` | Identity. Defaults to the exact filename stem. |
| `description` | Selector description. |
| `tools` | Explicit active tools. Omit for the captured baseline; `[]` means no tools. |
| `excludeTools` | Removed after `tools`; exclusion wins. YAML arrays and comma-separated strings work. |
| `model` | Exact `provider/model-id`, or a bare exact ID. Omit or use `inherit` for baseline. |
| `thinking` | Pi level: `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`. Omit for baseline. |
| `systemPromptMode` | `replace` (default) replaces only Pi's append layer; `append` preserves it and adds the body. |
| `modeOrder` | Sort prefix only. |
| `hotkey` | Direct activation shortcut. |

The sort key is `(modeOrder ?? "") + name + sourcePath` with ordinary
JavaScript string comparison. It has no locale, numeric, or case normalization.

This format intentionally supports only the documented subset of
[`pi-subagents` agent frontmatter](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md#frontmatter-reference).
It does not import `pi-subagents` or its private parser.

## Commands and shortcuts

* `/pi-mode` opens a searchable Pi selector.
* `/pi-mode <name>` activates an exact mode.
* `/pi-mode off` restores the captured session baseline.
* `/pi-mode status` reports the active mode, resolved settings, source, and
  catalog diagnostics.

The selector starts with **No active mode**. With one configured mode,
`cycleHotkey` toggles between that mode and **No active mode**. With multiple
modes, it continues cycling only sorted modes. Per-mode `hotkey` values activate
directly. A cycle collision wins over a direct mode binding and produces a
warning. Pi reports collisions with other extensions; changing bindings requires
`/reload` because Pi has no unregister API.

The footer shows `mode:<name>` while a mode is active and clears otherwise.
`/pi-mode status` shows the source plus effective resolved model, thinking,
tools after exclusions, and the exclusions themselves. The exact names `off`
and `status` are reserved command verbs; `Off` and `Status` remain distinct
valid mode names.

## Runtime semantics

Immediately before the first successful activation, `pi-modes` captures the
current model, thinking level, and active tool names. It restores that exact
baseline with `/pi-mode off`. Each mode resolves from this baseline, never from
the preceding mode, so repeated transitions cannot erode it.

Transitions are atomic: `pi-modes` resolves configuration, snapshots current
state, applies model then thinking then tools, and rolls back if a mutation step
fails. Warnings append durable, context-excluded `pi-modes-warning` entries and
show Pi warning notifications when a UI context is available.

Recoverable configuration and resolution problems degrade gracefully without
rewriting mode configuration or persisted baselines:

| Condition | Behavior |
| --- | --- |
| Unavailable requested tool | Warn, omit it, and apply the remaining tools. If none remain, apply `[]`. |
| Unknown `excludeTools` name | No-op without a warning; exclusions only apply to requested candidates. |
| Missing or ambiguous configured model | Warn and use the captured baseline model. |
| Unsupported configured thinking level | Warn and use the captured baseline thinking level. |
| Unsupported saved baseline thinking level | Warn and use the current runtime thinking for that restore without rewriting the saved baseline. |
| Missing saved mode | Restore the saved baseline and clear the active mode, with a warning. |
| Malformed mode/config file | Skip or default it according to catalog diagnostics, with a warning. |

Busy sessions, external guard denials, unavailable authentication, and runtime
mutation failures remain blocking. They warn, roll back any partial mutation,
and preserve the previous mode state.

A `tools` list selects Pi's advertised and callable active-tool surface. It
does not grant permission for individual calls. Permission extensions can still
hide or block a selected tool and remain the final authority. `/pi-mode status`
shows the effective applied model, thinking level, and tools; omitted tool names
remain in the source configuration or saved baseline for future restores.

`provider/model-id` resolves through Pi's normal model registry. A provider
extension such as `pi-model-alias` can therefore provide `alias/gpt-high`
without a dependency from this package. For a bare ID, `pi-modes` prefers the
baseline provider, otherwise requires one exact match across providers.

## Prompt composition and lifecycle

Mode bodies affect only Pi's append-system-prompt layer. `append` preserves
existing `APPEND_SYSTEM.md` text and inserts the body after it. `replace`
replaces only the exact append text supplied by Pi and preserves the base
prompt, project context, skills, tool descriptions, and changes made by earlier
extensions. If the exact text cannot be found, the prompt remains unchanged and
a durable context-excluded warning entry is recorded and a visible Pi warning
notification is shown when available. Mode bodies never enter persistent model
context.

State is persisted per session branch as a `pi-modes-state` custom entry. It is
restored after resume, fork, reload, and tree navigation. Session-start restore
defers one event-loop turn so tools registered by later `session_start` handlers
are available for validation; permanently unavailable tools warn once, are
omitted from that apply, and remain in persisted state for later restoration. Moving to a branch before mode activation restores the previous
in-memory baseline before clearing mode state. If the saved mode is missing, the
saved baseline is restored and a warning is recorded. Successful transitions and lifecycle restores emit
`pi-modes:changed`; restores do not rewrite historical branch state. The
extension applies state only for an explicit transition or lifecycle restore;
later user or extension changes win until the user selects a mode again.

## Coexistence

`pi-modes` has an optional external guard chain. The included Plannotator
adapter sends the public `plannotator:request` `plan-mode/status` event. A
non-idle response blocks transitions and asks the user to finish or exit
Plannotator first. A missing listener times out after about 275 ms, is cached
as absent for the session, and is treated as permitted.
No Plannotator package is imported.

For Plannotator, set `executionMode` to `external`. Plan approval then restores
its pre-planning state, emits its handoff, returns to idle, and lets the user
select an execution mode normally. This avoids competing ownership of the
parent session.

The package is designed to coexist without a load-order requirement with
`@gotgenes/pi-permission-system`: it does not call `setActiveTools()` from
`before_agent_start`, transforms only the append layer, and never overrides a
permission extension's final `tool_call` gate. `pi-tool-manager` and similar
extensions can alter tools after activation; Pi has no general ownership
protocol, so those later changes intentionally remain in effect.

## Security

Modes can select tools and modify Pi's append-system-prompt layer. They cannot
grant permission, bypass a permission extension, or contain processes. Treat
mode files as executable agent configuration and review files from other
people before loading them. See [SECURITY.md](SECURITY.md) for reporting and
the full trust boundary.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run pack:check
```

The suite currently contains 36 tests. Package checks verify that the npm
tarball contains runtime source, schemas, documentation, and license files,
but not tests, local configuration, or dependencies.

## Releases

This package uses Semantic Versioning. The first npm publication is manual;
later `v<version>` GitHub releases rerun all checks and publish through trusted
publishing with provenance. Follow [RELEASING.md](RELEASING.md), update
`CHANGELOG.md`, and document the Pi compatibility baseline for each minor
release.

## License

MIT © Dustin Fox. See [LICENSE](LICENSE).
