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

## Development Rules
See `.cursorrules` for all development rules and guidelines.

## Key Findings

### Command Execution
- NEVER pass command args as multiple array entries when using fly machines exec
- BAD: `["sh", "-c", "mkdir -p /home/dev/.ssh"]`
- GOOD: `["sh -c \"mkdir -p /home/dev/.ssh\""]`
- Command array items need proper quoting
- Full paths (e.g. /bin/ls) are more reliable
- Different apps may require different command formats

### Machine State Issues
- Machines can get "wedged" causing EOF errors
- Error manifests as: "unknown: failed to run command: EOF"
- This is a machine state issue, not a command format problem
- Solution: Restart the machine when this occurs

### SSH Key Management
- Keys stored in ./tmp directory (added to .gitignore)
- Using base64 encoding for key transfer prevents quoting/escaping issues
- Proper permission handling (700 for .ssh dir, 600 for authorized_keys)
- Public key installed to /home/dev/.ssh/authorized_keys
- SSH Connection:
  - Requires proxy process to be running
  - Uses port 2222 by default
  - Explicit key path needed (-i ./tmp/test_key)

### Container Setup
- Using s6-overlay for service management
- Proper signal handling
- Clean shutdown support
- OverlayFS for development isolation 