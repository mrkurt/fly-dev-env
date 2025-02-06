# Plan for Managing State and System Layers on Fly Dev Machines

## Overview
This document details the design and implementation of a migration system for Fly Dev Machines that separates **mutable state** from **system configuration and binaries**, enabling reproducible and incremental system changes.

### Goals
- **Split stateful and immutable files cleanly**: Store mutable state in `/data/state`, while keeping system-level changes in `/data/system` and `/data/system/layers`.
- **Manage migrations**: Provide a wrapper utility that tracks system modifications and ensures clean upgrades.
- **Support services and libraries**: Libraries modify the system, while services get s6 service definitions and state tracking.
- **Enable incremental system updates**: Each migration applies a new overlayfs layer, capturing only relevant system changes.
- **Migration tracking and versioning**: Implement a structured migration naming and tracking scheme inspired by Rails DB Migrations to ensure correct application of updates.
- **Locking mechanism**: Prevent concurrent migrations by implementing a locking system.
- **Rollback strategy**: Cleanly revert system and state changes if a migration fails.

## System Structure

### Filesystem Layout
- **Base OS**: A small readonly root filesystem.
- **OverlayFS Upper Layer**: A writable layer that will be committed per migration.
- **Persistent Volume (`/data`)**: Mounted at `/data` and contains:
  - `/data/state/` → Bind-mounted to locations requiring persistent state.
  - `/data/system/` → Stores system-level modifications, including installed binaries and services.
  - `/data/system/layers/` → Tracks overlayfs layers used to manage incremental migrations.
  - `/data/system/migrations/` → Stores migration metadata and versioning.
  - `/data/system/lock/` → Stores a lock file to ensure only one migration runs at a time.

### Essential Bind Mounts
To maintain a functioning system, these directories are always bind-mounted:
```sh
essential_mounts=(
    "/dev"
    "/proc"    # Required for process information
    "/sys"
    "/run"
    "/sys/fs/cgroup"    # Required for systemd cgroups
)
```
These mounts ensure that system services function normally inside the overlayed root.

## Migration System Design

### Migration Wrapper Utility
A wrapper utility (`system-migrate`) manages state migrations and overlays. It performs the following steps:

1. **Start a new overlayfs layer**
   - Create a new writable layer in `/data/system/layers/20240206-<inc>_<label>/`.
   - Mount it as an upper layer on top of the existing system.

2. **Ensure only one migration runs at a time**
   - Check for a lock file in `/data/system/lock/`. If it exists, exit.
   - Create a lock file before starting the migration.
   - Remove the lock file upon success or failure.

3. **Setup auditd to track file changes**
   - Start auditd (if not running):
     ```sh
     systemctl start auditd
     ```
   - Track file changes from the install script:
     ```sh
     auditctl -a always,exit -S all -F pid=<script_pid> -k migration_tracking
     ```

4. **Run the provided install script**
   - The script is expected to perform installation (e.g., install PostgreSQL via a package manager).
   - If it **fails**, rollback the overlayfs layer and revert state changes.

5. **Capture file changes**
   - Retrieve all modified files:
     ```sh
     ausearch -k migration_tracking
     ```
   - Filter out changes to state directories (`/var/lib`, `/var/log`, etc.).

6. **Link state files into layer**
   - Any files that belong in state mounts (`/data/state/...`) get hardlinked there.

7. **Rollback strategy (if migration fails)**
   - Remove the failed overlayfs layer.
   - Restore previous system state.
   - Ensure `/data/state/` is reverted (manual cleanup may be required for complex cases).

8. **Setup s6 service definitions (if a service)**
   - If installing a service:
     - Write an s6 service definition.
     - Create a **pre-start script** that ensures required state files are linked back into `/var/` before the service starts.
     - Mark the service as initialized in `/data/state/services/`.

9. **Implement migration tracking and versioning**
   - Migrations are stored in `/data/system/migrations/`, each identified by a timestamp and a descriptive name (e.g., `20240206-001_add_postgresql`).
   - A metadata file tracks applied migrations to prevent duplicate execution.
   - The system-migrate tool checks this metadata and only applies new migrations.
   - Example migration metadata format:
     ```sh
     /data/system/migrations/
     ├── 20240206-001_add_postgresql/
     │   ├── applied
     │   ├── changes.list
     │   ├── install_script.sh
     └── metadata.json
     ```

10. **Commit the layer**
    - Finalize the migration by locking in the new overlayfs layer.
    - Prepare a new empty writable layer for the next migration.

## Local Development & Testing Guidelines

### Testing on macOS with Colima
1. **Ensure Colima is running**
   ```sh
   colima start
   ```

2. **Run a privileged container to test OverlayFS**
   ```sh
   docker run --rm -it --privileged ubuntu bash
   ```
   Inside the container, verify OverlayFS support:
   ```sh
   grep overlay /proc/filesystems
   ```

3. **Manually create an OverlayFS mount for testing**
   ```sh
   mkdir -p /lower /upper /work /merged
   touch /lower/file1
   mount -t overlay overlay -o lowerdir=/lower,upperdir=/upper,workdir=/work /merged
   ls /merged
   ```

### Running the Migration System in Docker Locally
1. **Build the migration utility container**
   ```sh
   docker build -t migration-test .
   ```

2. **Run a test migration**
   ```sh
   docker run --rm --privileged migration-test /bin/bash -c "system-migrate install postgresql"
   ```

3. **Check applied migrations**
   ```sh
   docker exec -it <container-id> ls /data/system/migrations/
   ```

### When to Use a Native Linux Host
- If OverlayFS is not working inside Colima.
- If performance benchmarking is required.
- If deeper kernel modifications or testing are necessary.

Colima should work for most development tasks, but using a real Linux host ensures an exact match to production environments.

## Next Steps
Future improvements will include:
- **Rollback support**: Revert to previous layers if needed.
- **Layer squashing**: Merge layers to reduce overhead.
- **Dependency tracking**: Ensure services install required dependencies before activation.

This setup ensures that all service and system modifications are **incremental, reproducible, and isolated from runtime state changes**.

