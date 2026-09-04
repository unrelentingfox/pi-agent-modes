# Security

## Reporting

Report vulnerabilities privately through [GitHub security advisories](https://github.com/unrelentingfox/pi-agent-modes/security/advisories/new). Do not open a public issue for an undisclosed vulnerability.

## Trust boundary

Pi packages execute with the user's permissions. `pi-agent-modes` changes Pi's selected model, thinking level, active tool surface, and append-system-prompt projection. It is not a sandbox and does not grant or enforce tool-call permission. Review mode files before loading them, and use a separate permission or sandbox layer for enforcement.

Only the latest release receives security fixes.
