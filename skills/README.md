# Code-Synapse Skills

Pre-configured skills for AI coding assistants to integrate with Code-Synapse.

## Available Skills

### [Cursor](./cursor/)

Skills for [Cursor](https://cursor.sh/) AI code editor.

**Files:**
- `vibe-coding.md` - Overview and setup instructions
- `cursor-rules.txt` - Rules for AI behavior (copy to `.cursorrules`)
- `mcp-config.json` - MCP server configuration (copy to `.cursor/mcp.json`)

### [Claude Code](./claude-code/)

Skills for [Claude Code](https://claude.ai/code) CLI.

**Files:**
- `vibe-coding.md` - Overview and setup instructions
- `CLAUDE-SKILL.md` - Skill instructions (add to `CLAUDE.md`)
- `mcp-config.json` - MCP server configuration (copy to `~/.claude.json` or `.mcp.json`)

## Quick Start

### 1. Start Code-Synapse

```bash
# In your project directory
code-synapse start
```

This starts the MCP server on `http://localhost:3100/mcp`.

### 2. Configure Your AI Tool

#### For Cursor

```bash
# Copy MCP config
cp skills/cursor/mcp-config.json .cursor/mcp.json

# Edit to use correct URL if not localhost:3100
vi .cursor/mcp.json

# Optionally, add rules
cp skills/cursor/cursor-rules.txt .cursorrules
```

#### For Claude Code

```bash
# Copy MCP config to project
cp skills/claude-code/mcp-config.json .mcp.json

# Edit to use correct project path
vi .mcp.json

# Add skill to CLAUDE.md
cat skills/claude-code/CLAUDE-SKILL.md >> CLAUDE.md
```

### 3. Use Vibe Coding

Once configured, your AI assistant will have access to:

| Tool | Description |
|------|-------------|
| `vibe_start` | Start a coding session with enriched context |
| `vibe_change` | Record file changes for re-indexing |
| `vibe_complete` | Complete a coding session |
| `vibe_status` | Check session status |

Plus all the standard Code-Synapse tools for code intelligence.

## MCP Server URL

The skills expect an MCP server URL. You can:

1. **Use stdio transport** (recommended for Claude Code):
   ```json
   {
     "mcpServers": {
       "code-synapse": {
         "command": "code-synapse",
         "args": ["start"],
         "cwd": "/path/to/project"
       }
     }
   }
   ```

2. **Use HTTP transport** (for remote/shared servers):
   ```json
   {
     "mcpServers": {
       "code-synapse": {
         "url": "http://localhost:3100/mcp"
       }
     }
   }
   ```

## Custom Server URL

If your Code-Synapse server runs on a different port or host:

1. Edit the `mcp-config.json` in the relevant skill directory
2. Replace `http://localhost:3100/mcp` with your server URL
3. Copy to your project's MCP configuration location

## Creating Custom Skills

You can create custom skills by:

1. Creating a new directory under `skills/`
2. Adding configuration and instruction files
3. Following the pattern of existing skills

The vibe coding tools (`vibe_start`, `vibe_change`, `vibe_complete`, `vibe_status`) are always available when the Code-Synapse MCP server is connected.

## Troubleshooting

### MCP Server Not Connected

1. Ensure Code-Synapse is installed: `npm install -g @autorail/code-synapse`
2. Start the server: `code-synapse start`
3. Check the server URL in your MCP configuration

### Tools Not Available

1. Verify the MCP server is running
2. Check your AI tool's MCP configuration
3. Restart your AI tool to reconnect

### Stale Context

Run a full re-index:
```bash
code-synapse index
```
