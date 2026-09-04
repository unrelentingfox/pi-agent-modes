# Contributing

1. Use Node 22.19.0 or newer, matching the tested Pi release.
2. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run pack:check`.
3. Keep changes focused and add tests for behavior changes.
4. Use a semantic commit subject such as `fix(runtime): restore mode state`.

Releases use Semantic Versioning. Follow [RELEASING.md](RELEASING.md); the first npm publication is manual, and later matching GitHub releases publish with provenance.
