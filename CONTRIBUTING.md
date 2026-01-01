# Contributing to Code-Synapse

Thank you for your interest in contributing to Code-Synapse! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)
- [Submitting Changes](#submitting-changes)
- [Project Structure](#project-structure)

## Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please be respectful, inclusive, and constructive in all interactions.

## Getting Started

### Prerequisites

- **Node.js**: v20.0.0 or higher (v25 recommended)
- **pnpm**: v9.0.0 or higher
- **Git**: For version control
- **IDE**: VS Code or your preferred editor

### Initial Setup

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/code-synapse.git
   cd code-synapse
   ```

3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/code-synapse/code-synapse.git
   ```

4. **Install dependencies**:
   ```bash
   pnpm install
   ```

5. **Build the project**:
   ```bash
   pnpm build
   ```

6. **Run tests** to verify setup:
   ```bash
   pnpm test
   ```

## Development Workflow

### Creating a Branch

Always create a new branch for your work:

```bash
# Update your main branch
git checkout main
git pull upstream main

# Create a feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/your-bug-description
```

### Branch Naming Conventions

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions or improvements
- `chore/` - Maintenance tasks

### Making Changes

1. **Make your changes** following the coding standards
2. **Write or update tests** for your changes
3. **Run the test suite**:
   ```bash
   pnpm test
   ```

4. **Check code quality**:
   ```bash
   pnpm lint
   pnpm check-types
   ```

5. **Format code**:
   ```bash
   pnpm format
   ```

### Committing Changes

Write clear, descriptive commit messages:

```bash
git commit -m "Add Python language support

- Implement PythonParser using tree-sitter-python
- Add Python-specific entity extraction
- Add integration tests for Python parsing
- Update documentation with Python examples

Fixes #123"
```

**Commit Message Guidelines:**
- Use imperative mood ("Add feature" not "Added feature")
- First line should be a summary (50 chars or less)
- Include detailed description if needed
- Reference issues with "Fixes #123" or "Closes #456"

## Coding Standards

### TypeScript Guidelines

- **Strict Mode**: Always enabled - no `any` types without justification
- **ESM Modules**: Use `.js` extension in imports (required for ESM)
- **Type Imports**: Use `import type` for type-only imports
- **Node.js Imports**: Use `node:` prefix for built-in modules

### Code Style

- **Formatting**: Use Prettier (configured in the project)
- **Linting**: Follow ESLint rules (strict mode, max-warnings: 0)
- **Naming**: 
  - Classes: PascalCase
  - Functions/Variables: camelCase
  - Constants: UPPER_SNAKE_CASE
  - Files: kebab-case or index.ts

### Architecture Guidelines

- **Interfaces First**: Define interfaces before implementations
- **Dependency Injection**: Use factory functions for testability
- **Error Handling**: Use Result<T, E> type for error handling
- **Resource Management**: Use `using` keyword for automatic cleanup
- **Async/Await**: Prefer async/await over callbacks or raw promises

### Example Code Structure

```typescript
// ✅ Good: Interface-based, factory function, proper types
export interface IMyService {
  doSomething(input: string): Promise<Result<Output, Error>>;
}

export class MyService implements IMyService {
  constructor(private config: Config) {}

  async doSomething(input: string): Promise<Result<Output, Error>> {
    // Implementation
  }
}

export function createMyService(config: Config): IMyService {
  return new MyService(config);
}
```

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run specific test file
pnpm test src/core/parser/__tests__/parser.test.ts

# Run with coverage
pnpm test --coverage
```

### Writing Tests

- **Test Files**: Place in `__tests__/` directories or alongside source with `.test.ts` suffix
- **Test Structure**: Use Vitest's `describe` and `it` blocks
- **Naming**: Test names should describe what they verify
- **Coverage**: Aim for high coverage, especially for core functionality

### Test Example

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createParser } from "../parser/index.js";

describe("Parser", () => {
  let parser: IParser;

  beforeAll(async () => {
    parser = await createParser();
  });

  afterAll(async () => {
    await parser.close();
  });

  it("should parse TypeScript functions correctly", async () => {
    const code = `export function hello(): string { return "world"; }`;
    const result = await parser.parseCode(code, "test.ts");
    
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("hello");
  });
});
```

## Documentation

### Code Documentation

- **JSDoc Comments**: Add JSDoc for public APIs
- **Type Annotations**: Prefer explicit types over inference for public APIs
- **README Updates**: Update README.md for user-facing changes

### Documentation Files

- **README.md**: User-facing quick start and overview
- **docs/HOW-IT-WORKS.md**: Operational details and workflows
- **docs/ARCHITECTURE.md**: Technical architecture and design decisions
- **CONTRIBUTING.md**: This file - contribution guidelines

### Writing Documentation

- Use clear, concise language
- Include code examples
- Add diagrams where helpful
- Keep documentation up-to-date with code changes

## Submitting Changes

### Pull Request Process

1. **Push your branch** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a Pull Request** on GitHub:
   - Use a clear, descriptive title
   - Fill out the PR template
   - Link related issues
   - Add screenshots/examples if applicable

3. **PR Checklist**:
   - [ ] Code follows project style guidelines
   - [ ] Tests added/updated and passing
   - [ ] Documentation updated
   - [ ] No linting errors
   - [ ] Type checking passes
   - [ ] Commit messages are clear

4. **Respond to feedback**:
   - Address review comments
   - Update PR as needed
   - Keep discussions constructive

### PR Template

When opening a PR, include:

- **Description**: What changes are made and why
- **Type**: Feature, Bug Fix, Documentation, etc.
- **Testing**: How the changes were tested
- **Breaking Changes**: If any, describe migration path
- **Related Issues**: Link to related issues

## Project Structure

```
src/
├── cli/              # CLI commands and user interface
├── mcp/              # MCP server implementation
├── core/             # Core business logic
│   ├── parser/       # Code parsing
│   ├── graph/        # Database operations
│   ├── indexer/      # Indexing orchestration
│   ├── extraction/   # Entity extraction
│   ├── embeddings/   # Vector embeddings
│   └── llm/          # LLM inference
├── types/            # TypeScript type definitions
└── utils/            # Shared utilities

docs/                 # Documentation
tests/                # Integration tests (if any)
```

### Where to Add Code

| If you're adding... | Put it in... |
|---------------------|--------------|
| New CLI command | `src/cli/commands/` |
| New MCP tool | `src/mcp/tools.ts` |
| New language parser | `src/core/parser/` |
| Database operations | `src/core/graph/` |
| Entity extraction | `src/core/extraction/` |
| Shared types | `src/types/` |
| Utilities | `src/utils/` |

## Getting Help

- **GitHub Discussions**: Ask questions and share ideas
- **GitHub Issues**: Report bugs or request features
- **Documentation**: Check [HOW-IT-WORKS.md](./docs/HOW-IT-WORKS.md) and [ARCHITECTURE.md](./docs/ARCHITECTURE.md)

## Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes
- Project documentation

Thank you for contributing to Code-Synapse! 🎉

