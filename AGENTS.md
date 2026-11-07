# Agents

Project documentation for coding agents lives in `agents/`:

- `agents/architecture.md`: code layout, invariants, development and deployment.
- `agents/protocol.md`: the Fairbuds 2 RACE protocol and EQ format, with the limits the page depends on.
- `presets/README.md`: preset file format.

Rules:

- Never send hand-built tables to the buds; go through `design()` or `solo()`. More than 10 sections per table reversibly breaks the
  partner bud.
- Keep the page dependency-free and buildless.
- Comments explain why, not what. No comments that restate the code.
- Run `npm test` and `node scripts/build.mjs` before committing.
