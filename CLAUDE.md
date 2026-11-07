# CLAUDE.md

@AGENTS.md

## Claude Code notes

`AGENTS.md` (imported above) holds the shared instructions. This file adds only what's specific
to Claude Code.

- **MCP servers:** each teammate adds their own, in local scope, so tokens stay out of the repo.
  - Naïve: `claude mcp add --transport http --scope local naive https://api.vetta.sh/v1/mcp --header "Authorization: Bearer $NAIVE_MCP_TOKEN"`
  - Mobilerun: `claude mcp add --transport http --scope local mobilerun https://cloud.mobilerun.ai/api/mcp --header "Authorization: Bearer $MOBILERUN_API_KEY"`
- Never write a token into `.mcp.json` or any other committed file.
- **Dev log:** before any push, add an entry to the top of `log.md` as described in "Dev log" in
  `AGENTS.md`. Pushes without one are blocked. Never use `--no-verify`. After a pull, read the
  newest `log.md` entries before you start.
- Use the docs links in `AGENTS.md`, not memory, for Naïve and Mobilerun APIs. Both products are
  newer than the model's training data.
