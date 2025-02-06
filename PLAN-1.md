# PLAN-1: Hello World System Migration Test Setup

## Overview
This plan outlines the minimal setup needed to test our system migration tooling in Docker containers using Deno.

## Project Structure
```
.
├── deno.json        # Deno configuration (permissions, import maps, tasks)
├── mod.ts           # Main CLI entry point (argument parsing, command routing)
├── lib/            # Core library code (non-CLI-specific)
│   ├── docker.ts   # Docker container management
│   ├── overlay.ts  # Overlayfs operations
│   └── migrate.ts  # Migration core logic
├── commands/       # CLI command implementations
│   └── migrate.ts  # Migration command handler
└── tests/         # Test directory
    ├── fixtures/  # Test data and containers
    │   └── Dockerfile.test  # Test container definition
    └── migrate_test.ts  # Migration integration tests
```

## Implementation Steps

### 1. Basic Test Container
Create a minimal Docker test environment that:
- Uses Ubuntu 22.04 base image
- Has overlayfs support enabled
- Provides mount capabilities
- Has directories set up for testing overlayfs operations

### 2. Deno Test Framework
Create a minimal Deno app that can:
- Build and run the test container
- Execute commands inside it
- Verify results
- Clean up after tests

### 3. Hello World Test
Implement a basic test that:
1. Builds the test container
2. Creates an overlayfs mount
3. Writes "Hello World" to a file in the upper layer
4. Verifies the file exists in the merged view
5. Verifies the lower layer is unchanged

## Example Test Code (Pseudo-code)
```typescript
// migrate_test.ts
Deno.test("overlayfs hello world", async (t) => {
  // Build and start test container
  const container = await startTestContainer();
  
  try {
    // Mount overlayfs
    await container.exec([
      "mount", "-t", "overlay", "overlay",
      "-o", "lowerdir=/test/lower,upperdir=/test/upper,workdir=/test/work",
      "/test/merged"
    ]);
    
    // Write test file
    await container.exec([
      "sh", "-c",
      "echo 'Hello World' > /test/merged/hello.txt"
    ]);
    
    // Verify file exists in merged view
    const mergedContent = await container.exec([
      "cat", "/test/merged/hello.txt"
    ]);
    assertEquals(mergedContent.trim(), "Hello World");
    
    // Verify lower dir unchanged
    const lowerExists = await container.exec([
      "test", "-f", "/test/lower/hello.txt"
    ]);
    assertEquals(lowerExists.success, false);
    
  } finally {
    // Cleanup
    await container.stop();
  }
});
```

## Running Tests
Tests will be run with:
```bash
deno test
```

## Success Criteria
- [x] Test container builds successfully
- [x] Overlayfs mount works in container
- [x] Can write and read files through overlayfs
- [x] Lower layer remains unchanged
- [x] Tests clean up after themselves

## Next Steps After Hello World
1. Implement basic migration tracking
2. Add state directory management
3. Create service installation test
4. Build out full migration system

## Notes
- All tests run in Docker for consistency
- No external state or dependencies needed
- Fast iteration cycle for development
- Clean separation of concerns
- Following Deno best practices 