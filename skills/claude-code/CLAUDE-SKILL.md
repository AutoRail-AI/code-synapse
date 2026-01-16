# Vibe Coding Skill

## Overview

You have access to Code-Synapse, a knowledge engine that deeply understands this codebase. Use it to write better, more contextual code.

## MCP Server

The Code-Synapse MCP server provides tools for context-aware coding. Before using vibe coding tools, ensure the MCP server is connected.

**To check connection**: Look for `code-synapse` in the available MCP tools.

**To start the server**: Run `code-synapse start` in the project directory.

## Vibe Coding Workflow

### Step 1: Start Session (BEFORE coding)

ALWAYS use `vibe_start` before starting any non-trivial coding task:

```json
{
  "intent": "What you're about to do",
  "targetFiles": ["files/you/plan/to/modify.ts"],
  "relatedConcepts": ["relevant", "keywords"]
}
```

This returns:
- **Relevant code**: Functions, classes related to your task
- **Business justifications**: WHY the code exists, not just what it does
- **Relationships**: Who calls what, dependencies
- **Patterns**: Detected architectural patterns (Service Layer, Repository, etc.)
- **Conventions**: Naming, error handling, import style

**USE THIS CONTEXT** when generating code.

### Step 2: Generate Code (WITH context)

When writing code:
1. Follow the detected patterns
2. Use the naming conventions
3. Consider the business justifications
4. Maintain consistency with existing code

### Step 3: Record Changes (AFTER each file)

ALWAYS use `vibe_change` after modifying any file:

```json
{
  "sessionId": "vibe_xxx_from_step_1",
  "filePath": "path/to/changed/file.ts",
  "changeType": "modified",
  "description": "What you changed"
}
```

This triggers:
- Re-indexing of the changed file
- Update of business justifications
- Recording in the change ledger

### Step 4: Complete Session (WHEN done)

ALWAYS use `vibe_complete` when finishing:

```json
{
  "sessionId": "vibe_xxx_from_step_1",
  "summary": "What was accomplished"
}
```

## Code Intelligence Tools

Also available for understanding the codebase:

| Tool | Use When |
|------|----------|
| `search_code` | Finding code by name/pattern |
| `get_function` | Understanding a function's details |
| `get_class` | Understanding a class's structure |
| `get_callers` | Seeing who depends on code you're modifying |
| `get_callees` | Seeing what code calls |
| `get_dependencies` | Understanding file relationships |

## Best Practices

1. **Always start sessions**: Even for small tasks, the context is valuable
2. **Be specific with intent**: "Add email validation" is better than "fix signup"
3. **Record all changes**: Every file modification should trigger `vibe_change`
4. **Complete sessions**: Ensures proper audit trails
5. **Use business context**: The justifications tell you WHY code exists

## Example Session

```
User: Add email validation to signup

1. Claude calls vibe_start:
   {
     "intent": "Add email validation to user signup form",
     "targetFiles": ["src/auth/signup.ts"],
     "relatedConcepts": ["validation", "email"]
   }

2. Claude receives context showing:
   - Existing validators and their patterns
   - Error handling conventions
   - Business justification for signup flow

3. Claude writes code following those patterns

4. Claude calls vibe_change:
   {
     "sessionId": "vibe_xxx",
     "filePath": "src/auth/signup.ts",
     "changeType": "modified",
     "description": "Added validateEmail function"
   }

5. Claude calls vibe_complete:
   {
     "sessionId": "vibe_xxx",
     "summary": "Added email validation with RFC-compliant pattern"
   }
```

## Troubleshooting

- **Tools not available**: Check MCP server connection
- **Thin context**: Add more relatedConcepts or specify targetFiles
- **Stale context**: Run `code-synapse index` to re-index
