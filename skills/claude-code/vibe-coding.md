# Vibe Coding Skill for Claude Code

This skill enables context-aware AI coding with Code-Synapse.

## Configuration

Add to your `~/.claude.json` or `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "code-synapse": {
      "command": "code-synapse",
      "args": ["start"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

OR use HTTP transport:

```json
{
  "mcpServers": {
    "code-synapse": {
      "url": "${MCP_SERVER_URL}"
    }
  }
}
```

Replace `${MCP_SERVER_URL}` with your Code-Synapse server URL (e.g., `http://localhost:3100/mcp`).

## Skill Instructions

Copy the contents of `CLAUDE-SKILL.md` to your project's `CLAUDE.md` file or add them as skill instructions.

## Available Tools

When the MCP server is connected, Claude Code will have access to:

### Vibe Coding Tools
- `vibe_start` - Start a coding session with enriched context
- `vibe_change` - Record file changes for re-indexing
- `vibe_complete` - Complete a coding session
- `vibe_status` - Check session status

### Code Intelligence Tools
- `search_code` - Search for code entities
- `get_function` - Get function details with callers/callees
- `get_class` - Get class details with methods
- `get_file_symbols` - Get all symbols in a file
- `get_callers` - Get all callers of a function
- `get_callees` - Get all callees of a function
- `get_dependencies` - Get file dependencies
- `get_project_stats` - Get project statistics
- `notify_file_changed` - Notify about file changes
- `request_reindex` - Request re-indexing
- `enhance_prompt` - Enhance prompts with context
- `create_generation_context` - Create post-generation context
