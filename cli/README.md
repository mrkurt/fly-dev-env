# System Migration CLI

A tool for managing system-level migrations in development environments.

## Development Setup

1. Install Deno: https://deno.com/manual/getting_started/installation
2. Install Docker: https://docs.docker.com/get-docker/

## Project Structure

```
cli/
├── deno.json             # Project config, dependencies, tasks
├── src/                  # Source code directory
│   ├── main.ts          # CLI entry point
│   ├── commands/        # Command implementations
│   │   └── migrate.ts   # Migration command
│   ├── core/           # Core functionality
│   │   ├── docker.ts   # Docker interaction
│   │   └── overlay.ts  # Overlayfs operations
│   └── test/          # Tests directory
│       ├── fixtures/  # Test data/containers
│       └── hello_test.ts
└── README.md           # This file
```

## Running Tests

```bash
# Run all tests
deno task test

# Run specific test file
deno test src/test/hello_test.ts
```

## Development Workflow

1. Write tests first in `src/test/`
2. Implement functionality in `src/core/` and `src/commands/`
3. Run tests to verify
4. Format code: `deno fmt`
5. Type check: `deno task check`

## Test Container

The test environment uses a minimal Ubuntu container with overlayfs support. See `src/test/fixtures/Dockerfile.test` for details. 