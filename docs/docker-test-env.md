# Docker Test Environment Plan

## Overview
We need to modify our test environment to match the production setup, using s6 and overlayfs-init to provide a realistic testing environment for our migration system. Tests will run as an s6 oneshot service to ensure proper initialization and cleanup.

## Directory Structure
```
/data/
  ├── state/     # Mutable state (persistent)
  └── system/    # System changes (created at runtime on tmpfs by overlayfs-init)
      ├── upper/     # Overlay upper dir
      ├── work/      # Overlay work dir
      ├── layers/    # Migration layers
      ├── migrations/  # Migration metadata
      └── lock/     # Migration locks
```

## Build Steps (Dockerfile.test)

1. Base Image Setup:
   ```dockerfile
   FROM ubuntu:22.04
   
   # Install required packages
   RUN apt-get update && apt-get install -y \
       mount \
       util-linux \
       kmod \
       curl \
       unzip \
       s6 \
       && rm -rf /var/lib/apt/lists/*
   ```

2. Directory Structure:
   ```dockerfile
   # Create required directories
   RUN mkdir -p \
       /data \
       /data/state
   ```

3. Deno Setup (as before):
   ```dockerfile
   ENV DENO_VERSION=2.1.5
   RUN curl -fsSL https://deno.land/x/install/install.sh | DENO_INSTALL=/usr/local sh -s v${DENO_VERSION}
   ```

4. Test Setup:
   ```dockerfile
   WORKDIR /app
   COPY . .
   RUN deno cache --lock=deno.lock mod.ts
   ```

5. Init Script:
   ```dockerfile
   COPY tests/image/overlayfs-init /usr/local/bin/
   RUN chmod +x /usr/local/bin/overlayfs-init
   ```

6. S6 Service Setup:
   ```dockerfile
   # Test runner service
   COPY tests/s6/test-runner/run /etc/s6/test-runner/
   COPY tests/s6/test-runner/finish /etc/s6/test-runner/
   RUN echo "oneshot" > /etc/s6/test-runner/type && \
       chmod +x /etc/s6/test-runner/run /etc/s6/test-runner/finish

   # s6 scan directory finish script
   COPY tests/s6/finish /etc/s6/.s6-svscan/
   RUN chmod +x /etc/s6/.s6-svscan/finish
   ```

## S6 Service Scripts

1. Test Runner Service (`/etc/s6/test-runner/run`):
   ```sh
   #!/bin/sh
   set -e

   # Run tests with all permissions
   cd /app
   exec deno test --allow-all
   ```

2. Test Runner Finish (`/etc/s6/test-runner/finish`):
   ```sh
   #!/bin/sh
   # $1 = exit code
   # $2 = signal (if any)

   # Store test result for container exit code
   echo "$1" > /run/test-status
   ```

3. S6 Scan Finish (`/etc/s6/.s6-svscan/finish`):
   ```sh
   #!/bin/sh
   # Read test status and exit with same code
   exit $(cat /run/test-status)
   ```

## Container Startup Flow

1. Container starts with overlayfs-init as entrypoint:
   ```dockerfile
   ENTRYPOINT ["/usr/local/bin/overlayfs-init"]
   CMD ["/bin/s6-svscan", "/etc/s6"]
   ```

2. Execution Flow:
   - overlayfs-init sets up filesystem
   - s6-svscan starts and finds test-runner
   - test-runner starts auditd and runs tests
   - test-runner finish script stores exit code
   - s6-svscan finish script exits container with test status

## Test Modifications Needed

1. Update test paths to use `/data` structure:
   ```typescript
   const SYSTEM_DIR = "/data/system";
   const STATE_DIR = "/data/state";
   ```

2. Add s6 service helper functions:
   ```typescript
   async function createService(name: string): Promise<void>;
   async function enableService(name: string): Promise<void>;
   ```

## Benefits of This Approach

1. **Realistic Environment**: Tests run in an environment that closely matches production
2. **Proper Initialization**: s6 ensures services start in correct order
3. **Clean Exit**: Container exits with actual test status
4. **State Tracking**: Can properly test state directory handling

## Next Steps

1. Create test s6 service scripts:
   - Create `tests/s6/` directory
   - Add run/finish scripts for test-runner
   - Add s6-svscan finish script

2. Update Dockerfile.test with new configuration:
   - Add s6 and auditd
   - Set up service structure
   - Copy service scripts

3. Modify test helper functions to use new paths

4. Add auditd and s6 helper functions

5. Update existing tests to use new structure

## Implementation Order

1. First create s6 service structure and scripts
2. Update Dockerfile.test with new setup
3. Test basic container startup and service execution
4. Add helper functions for auditd and s6
5. Update existing tests to use new paths
6. Add new tests for migration functionality

## Questions to Resolve

1. Should we run tests directly or through s6?
2. Do we need to modify overlayfs-init for the test environment?
3. How should we handle test artifacts and logs?
4. Should we add more debugging tools to the test image?

## Test Migration Steps

1. Update Directory Constants:
   ```typescript
   // Before:
   const TEST_DIR = "/test";
   
   // After:
   const SYSTEM_DIR = "/data/system";
   const STATE_DIR = "/data/state";
   ```

2. Update Test Paths:
   ```typescript
   // Before:
   await runCommand("mount", ["-t", "tmpfs", "tmpfs", "/test"]);
   await runCommand("mkdir", ["-p", "/test/lower", "/test/upper", "/test/work", "/test/merged"]);
   
   // After:
   // Note: No need to mount tmpfs - overlayfs-init handles this
   // Note: No need to create directories - overlayfs-init handles this
   
   // Just use the directories:
   const result = await runCommand("mount", [
     "-t", "overlay",
     "overlay",
     "-o", `lowerdir=/test/lower,upperdir=${SYSTEM_DIR}/upper,workdir=${SYSTEM_DIR}/work`,
     "/test/merged"
   ]);
   ```

3. Remove Cleanup Steps:
   ```typescript
   // Before:
   finally {
     if (needsCleanup) {
       await runCommand("umount", ["/test/merged"]);
       await runCommand("umount", ["/test"]);
     }
   }
   
   // After:
   // Note: No cleanup needed - container destruction handles this
   ```

4. Update Test File Locations:
   ```typescript
   // Before:
   echo "Hello from lower layer" > /test/lower/test.txt
   
   // After:
   // Put test files in state directory if they need to persist
   echo "Hello from lower layer" > /data/state/test.txt
   // Or in system directory if they're part of the system layer
   echo "Hello from lower layer" > /data/system/test.txt
   ```

5. Update Verification Steps:
   ```typescript
   // Before:
   const lowerResult = await runCommand("test", ["-f", "/test/lower/new.txt"]);
   
   // After:
   const systemResult = await runCommand("test", ["-f", "/data/system/new.txt"]);
   const stateResult = await runCommand("test", ["-f", "/data/state/new.txt"]);
   ```

## Key Test Changes

1. **No Manual Tmpfs**: 
   - Remove all tmpfs mounting code
   - overlayfs-init handles mounting tmpfs for `/data/system`

2. **Directory Creation**:
   - Remove manual directory creation
   - Only create test files/directories inside `/data/state` or `/data/system`

3. **Cleanup**:
   - Remove manual unmounting
   - Container cleanup handles all mounts

4. **State vs System**:
   - Be explicit about what goes in `/data/state` vs `/data/system`
   - Use state directory for persistent test data
   - Use system directory for system-level changes

5. **Test Organization**:
   - Group tests by state vs system operations
   - Add tests specifically for state persistence
   - Add tests for system layer isolation

## Implementation Steps

### 1. Create S6 Test Runner Files
Create in `tests/image/s6/`:
```
tests/image/s6/
├── test-runner/
│   ├── run         # Runs Deno tests
│   ├── finish      # Stores test exit code
│   └── type        # Contains "oneshot"
└── .s6-svscan/
    └── finish      # Exits with stored test status
```

### 2. Update Dockerfile.test
- Remove old test directory setup
- Use new overlayfs-init from tests/image
- Copy s6 service files to correct locations
- Set entrypoint and cmd

### 3. Update migrate_test.ts
- Remove manual tmpfs/directory creation
- Update paths to use /data/system
- Remove cleanup code
- Test basic overlay operations using new paths

### 4. Test and Verify
- Build new test container
- Run tests
- Debug any failures before proceeding

## Next Steps (after tests pass)
- Add migration functionality
- Add state persistence tests
- Add service management tests 