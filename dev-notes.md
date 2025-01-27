# Development Notes

## Project Overview
This project implements a development environment management system using Fly.io machines. The core functionality is built in Deno and provides CLI tools for managing SSH-based development environments.

## What Works

### SSH Key Management
- Successfully implemented SSH key installation and management
- Using base64 encoding for key transfer prevents quoting/escaping issues
- Proper permission handling (700 for .ssh dir, 600 for authorized_keys)
- Key verification after installation

### Command Execution
- Found that wrapping commands in `su dev -c` works reliably
- JSON.stringify for proper command escaping is essential
- Implemented robust command execution through Fly.io machines API
- Proper error handling and exit code checking

### Machine Management
- Successfully handling machine creation and updates
- Volume management for persistent storage
- Proper handling of machine state transitions
- Reliable deployment process

### Certificate Generation
- Successfully implemented temporary certificate generation
- Using host key as CA works well
- 1-hour certificate lifetime is appropriate for development use

## What Doesn't Work

### Command Arguments
- NEVER pass command args as multiple array entries when using fly machines exec
- BAD: `["sh", "-c", "mkdir -p /home/dev/.ssh"]`
- GOOD: `["sh -c \"mkdir -p /home/dev/.ssh\""]`

### Machine Updates
- NEVER use `fly machine update` - it does not work correctly
- NEVER use `fly image update` - it breaks image builds
- NEVER use `fly deploy` - it will destroy the machine setup
- Instead: Use machines API directly via fetch()

### Deployment Process
- Must use `fly deploy --build-only --push` for building images
- Direct machine API calls required for updates
- Cannot use standard Fly.io deployment tools

## Current Architecture

### Core Components
1. SSH Management (`ssh.ts`, `ssh-key.ts`)
2. Machine Management (`deploy.ts`)
3. Certificate Management (`get-cert.ts`)
4. Utility Functions (`util.ts`)

### Security Measures
- All operations run as non-root user
- SSH keys properly permissioned
- Certificate-based authentication
- No password authentication allowed

### Container Setup
- Using s6-overlay for service management
- Proper signal handling
- Clean shutdown support
- OverlayFS for development isolation

## Testing
- Comprehensive test suite for command escaping
- SSH key handling tests
- Command injection prevention tests
- Proper quoting and escaping verification

## Known Issues

### Command Execution
- Complex commands require careful escaping
- Nested quotes need special handling
- Must use single string for command to prevent injection

### Machine Management
- State transitions can be slow
- Need better error handling for timeouts
- Volume attachment process needs improvement

## Future Improvements

### Needed
1. Better error messages for common failures
2. Improved machine state monitoring
3. Faster deployment process
4. Better volume management
5. More comprehensive testing

### Nice to Have
1. Multiple machine support
2. Region selection
3. Resource scaling
4. Backup management
5. Development environment templates

## Development Rules

### Critical Rules
1. NEVER use `fly machine update`
2. NEVER use `fly image update`
3. NEVER use `fly deploy`
4. ONLY use `fly deploy --build-only --push` for images
5. ONLY use machines API directly for machine operations

### Deno Rules
1. ALL Deno work MUST be in ./cli directory
2. Use `jsr:` for dependencies
3. Use `deno.json` for dependency management
4. Pin all dependency versions
5. ALWAYS use `deno add` for packages
6. ALWAYS check `deno info <pkg>` before using
7. DO NOT use deprecated or unstable APIs
8. Keep features in single, complete files 