# Mount Setup Plan for Root Overlay

This document details the exact sequence of mounts needed before pivot_root when setting up an overlay root filesystem.

## Directory Structure

Required directories that must exist before starting:
```
/data/
├── state/          # Persistent state (bind mounted)
│   └── home/       # User home directories
└── system/         # System overlay data (tmpfs)
    ├── upper/      # Overlay upper directory
    ├── work/       # Overlay work directory
    ├── layers/     # Additional overlay layers
    ├── migrations/ # System migration state
    └── lock/       # Lock files
```

## Mount Types Explained

### System Data Mount (/data/system)
- **Type**: tmpfs
- **Purpose**: Provides temporary filesystem storage for overlay operations
- **Size**: 1GB - needed for storing overlay metadata and temporary system state
- **Why tmpfs**:
  - Ensures clean state on every boot
  - Fast in-memory access for overlay operations
  - Automatically cleaned up on shutdown

### State Directory Mount (/data/state)
- **Purpose**: Stores persistent user and system data
- **Content**: User home directories and other persistent state
- **Why bind mounted**:
  - Preserves data across reboots
  - Allows sharing between old and new root
  - Maintains existing file permissions and attributes

### Root Overlay Mount (/mnt/newroot)
- **Type**: overlay
- **Components**:
  - `lowerdir`: Original root filesystem (read-only base)
  - `upperdir`: Writable layer in tmpfs
  - `workdir`: Required by overlayfs for atomic operations
- **Why these options**:
  - Provides atomic and consistent filesystem modifications
  - Isolates changes from the base system
  - Enables rollback capability by discarding tmpfs

### Essential System Mounts

#### /run
- **Type**: tmpfs
- **Mode**: 0755 (rwxr-xr-x)
- **Why tmpfs**:
  - Contains runtime state that should not persist across reboots
  - Needs to be writable by system services
  - Mode 0755 allows system services to create runtime files

#### /dev
- **Type**: devtmpfs
- **Flags**:
  - If already mounted: --rbind followed by --make-rslave
  - If not mounted: mount -t devtmpfs followed by --make-rslave
- **Why these flags**:
  - `--rbind`: Ensures all device nodes and submounts are accessible
  - `--make-rslave`: Required for systemd device management
  - Fresh devtmpfs if not already mounted

#### /proc
- **Type**: proc
- **Flags**: --rbind followed by --make-rslave
- **Why these flags**:
  - `--rbind`: Captures all procfs mounts and submounts
  - `--make-rslave`: Required for proper process isolation

#### /sys
- **Type**: sysfs
- **Flags**: --rbind followed by --make-rslave
- **Why these flags**:
  - `--rbind`: Includes all sysfs hierarchies and submounts
  - `--make-rslave`: Required for proper device management

#### /sys/fs/cgroup
- **Type**: cgroup2
- **Flags**: mount -t cgroup2 followed by --make-rslave
- **Why these flags**:
  - Fresh cgroup2 mount for clean hierarchy
  - `--make-rslave`: Required for systemd cgroup management

#### /home
- **Type**: bind mount
- **Flags**: --rbind only
- **Why these flags**:
  - `--rbind`: Preserves all submounts in home directories
  - No --make-rslave needed since it's user data

### State Directory Mounts

#### /data
- **Type**: bind mount
- **Flags**: --rbind only
- **Why these flags**:
  - `--rbind`: Includes all state subdirectories
  - No --make-rslave needed since it's persistent state

#### /tmp
- **Type**: tmpfs
- **Mode**: 1777 (rwxrwxrwt)
- **Why these options**:
  - World-writable for all users
  - Sticky bit prevents file deletion by others
  - Cleaned on reboot for security

## Mount Propagation Explained

The mount flags serve different purposes:

### --rbind
1. **Completeness**: Ensures all submounts under a mountpoint are included
2. **Consistency**: Maintains the exact same mount structure as the original
3. **Simplicity**: Handles nested mounts without having to enumerate them

### --make-rslave
1. **System Mounts**: Required only for system mounts (/dev, /proc, /sys, cgroup)
2. **Systemd**: Needed for proper systemd operation
3. **Not Needed**: For user/state data mounts (/home, /data)

We use --make-rslave selectively because:
1. System mounts need it for proper operation with systemd
2. User/state data mounts don't need propagation control
3. The flags must match the actual mount requirements, not just isolation

## Mount Ordering Rationale

1. System tmpfs first:
   - Provides clean workspace for overlay
   - Needed before any overlay operations

2. State directory setup:
   - Ensures persistence locations exist
   - Required before mounting home

3. Root preparation:
   - Base for overlay operations
   - Home mounted here to exclude from overlay

4. Overlay setup:
   - Creates unified filesystem view
   - Must happen after root prep but before system mounts

5. System mounts:
   - Provides essential system interfaces
   - Must be done before pivot_root

6. State mounts last:
   - Depends on previous mounts
   - Provides unified view of all state

## Mount Sequence

### 1. System Data Setup
```bash
# Mount tmpfs for system data
mount -t tmpfs -o size=1G tmpfs /data/system

# Create required directories under tmpfs
mkdir -p /data/system/{upper,work,layers,migrations,lock}
```

### 2. State Directory Setup
```bash
# Ensure state directories exist
mkdir -p /data/state/home
mkdir -p /mnt/newroot/home
```

### 3. Root Preparation
```bash
# Bind mount current root to prepare for overlay
mount --bind / /mnt/newroot

# Unmount /home from new root if it exists
# This prevents /home from being included in root overlay
if mountpoint -q /mnt/newroot/home; then
    umount /mnt/newroot/home
fi

# Mount home from state before overlay
mount --rbind /data/state/home /mnt/newroot/home
```

### 4. Root Overlay Setup
```bash
# Mount overlay filesystem on new root
mount -t overlay overlay \
    -o lowerdir=/mnt/newroot,upperdir=/data/system/upper,workdir=/data/system/work \
    /mnt/newroot
```

### 5. Essential System Mounts

Mount points to create:
```bash
mkdir -p /mnt/newroot/{dev,proc,sys,run,sys/fs/cgroup,oldroot}
```

Mount sequence:
```bash
# /run - fresh tmpfs with runtime state copied
mount -t tmpfs -o mode=0755 tmpfs /mnt/newroot/run
cp -a /run/. /mnt/newroot/run/

# /dev - ensure devtmpfs
if mountpoint -q /dev && findmnt -n -o FSTYPE /dev | grep -q "^devtmpfs$"; then
    mount --rbind /dev /mnt/newroot/dev
    mount --make-rslave /mnt/newroot/dev
else
    mount -t devtmpfs none /mnt/newroot/dev
    mount --make-rslave /mnt/newroot/dev
fi

# /proc - process information
mount --rbind /proc /mnt/newroot/proc
mount --make-rslave /mnt/newroot/proc

# /sys - system information
mount --rbind /sys /mnt/newroot/sys
mount --make-rslave /mnt/newroot/sys

# /sys/fs/cgroup - cgroup v2 hierarchy
mount -t cgroup2 none /mnt/newroot/sys/fs/cgroup
mount --make-rslave /mnt/newroot/sys/fs/cgroup

# /home - bind mount from state
mount --rbind /data/state/home /mnt/newroot/home
```

### 6. State Directory Mounts
```bash
# Create state mount points
mkdir -p /mnt/newroot/data
mkdir -p /mnt/newroot/tmp

# Bind mount /data into new root
mount --rbind /data /mnt/newroot/data
```

## Mount Flags Explained

- `--rbind`: Recursively bind mount a directory and all its submounts
- `mode=0755`: Standard permissions for system directories
- `mode=1777`: World-writable with sticky bit (for /tmp)

## Important Notes

1. Order is critical - the overlay mount must happen after /home is mounted but before other system mounts

2. All mounts must be done before pivot_root to ensure they persist in the new root

3. The /home mount is handled specially:
   - Unmounted from new root before overlay
   - Mounted from state before overlay
   - This ensures it doesn't get included in the root overlay

4. System mounts (/dev, /proc, /sys) are made rslave to prevent mount propagation issues

5. The /data bind mount must happen last since other mounts depend on it
