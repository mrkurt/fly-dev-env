import { runCommand } from "../tests/helpers/cmd.ts";

// Mount setup system for Fly.io development environments
//
// This system creates a layered filesystem environment that:
// 1. Provides a writable layer over the read-only base system
// 2. Preserves state across container restarts
// 3. Isolates system changes for testing
// 4. Supports rolling back changes
//
// The mount hierarchy is:
// - overlayfs at / (lowerdir=base system, upperdir=/data/system/upper)
// - tmpfs at /data (for persistent state)
// - bind mounts for essential system directories
// - state directories for preserving data

// Configuration constants - paths are chosen to be clear and consistent
const SYSTEM_DIR = "/data/system";
const SYSTEM_SIZE = "1G";
const NEW_ROOT = "/mnt/newroot";
const STATE_DIR = "/data/state";

// Paths that need to persist across container restarts
// Each entry defines:
// - source: Original path in the container
// - target: Path under /data/state
// - mode: Permissions for the state directory
const STATE_PATHS = [
  {
    source: "/home",
    target: "home",
    mode: "0755",
    // Preserve user home directories
  },
  {
    source: "/var/lib",
    target: "var/lib",
    mode: "0755",
    // Preserve service data (databases, package managers, etc)
  }
];

interface MountError extends Error {
  command?: string;
  stderr?: string;
}

/**
 * Sets up a state directory with content copying
 *
 * State directories persist data across container restarts.
 * We copy existing content because:
 * 1. Preserves default files and permissions
 * 2. Handles first-time setup automatically
 * 3. Updates state with new package versions
 * 4. Maintains consistent state directory structure
 */
async function setupStateDirectory(statePath: { source: string; target: string; mode: string }): Promise<void> {
  const fullStatePath = `${STATE_DIR}/${statePath.target}`;
  const fullNewRootPath = `${NEW_ROOT}${statePath.source}`;

  console.log(`Setting up state directory for ${statePath.source}...`);

  // Check if state directory already exists
  const stateExists = await new Deno.Command("test", {
    args: ["-d", fullStatePath],
  }).output();

  if (!stateExists.success) {
    // Create new state directory with proper permissions
    const mkdirResult = await new Deno.Command("mkdir", {
      args: ["-p", fullStatePath],
    }).output();

    if (!mkdirResult.success) {
      throw new Error(`Failed to create state directory ${fullStatePath}`);
    }

    // Set proper permissions
    const chmodResult = await new Deno.Command("chmod", {
      args: [statePath.mode, fullStatePath],
    }).output();

    if (!chmodResult.success) {
      throw new Error(`Failed to set permissions on ${fullStatePath}`);
    }

    // Copy existing files if the source exists and has content
    const sourceExists = await new Deno.Command("test", {
      args: ["-d", statePath.source],
    }).output();

    if (sourceExists.success) {
      console.log(`Copying existing files from ${statePath.source} to new state directory...`);
      const cpResult = await new Deno.Command("cp", {
        args: ["-a", `${statePath.source}/.`, fullStatePath],
      }).output();

      if (!cpResult.success) {
        console.warn(`Warning: Failed to copy existing files from ${statePath.source}`);
      }
    }

    // If this is /home, write a timestamp file to mark when state was configured
    if (statePath.source === "/home") {
      const timestamp = new Date().toISOString();
      const writeResult = await new Deno.Command("sh", {
        args: ["-c", `echo "${timestamp}" > ${fullStatePath}/state-configured-at`],
      }).output();

      if (!writeResult.success) {
        console.warn("Warning: Failed to write state configuration timestamp");
      }
    }
  } else {
    console.log(`Using existing state directory at ${fullStatePath}`);
  }

  // Create mount point in new root
  const mountPointResult = await new Deno.Command("mkdir", {
    args: ["-p", fullNewRootPath],
  }).output();

  if (!mountPointResult.success) {
    throw new Error(`Failed to create mount point ${fullNewRootPath}`);
  }

  // Bind mount the state directory
  const mountResult = await new Deno.Command("mount", {
    args: ["--rbind", fullStatePath, fullNewRootPath],
  }).output();

  if (!mountResult.success) {
    throw new Error(`Failed to mount state directory ${fullStatePath}`);
  }

  console.log(`State directory ${statePath.source} setup complete`);
}

/**
 * Sets up system data tmpfs and directories
 *
 * The system data area provides:
 * 1. Writable space for overlayfs
 * 2. Migration tracking and metadata
 * 3. Lock files for concurrency control
 * 4. Layer tracking for the overlay
 *
 * Using tmpfs ensures clean state on container start
 */
async function setupSystemData(): Promise<void> {
  console.log("Setting up system data...");

  // Create required directories under /data
  const subdirs = [
    `${SYSTEM_DIR}/upper`,   // For overlay upper layer
    `${SYSTEM_DIR}/work`,    // For overlay work directory
    `${SYSTEM_DIR}/layers`,  // For tracking overlay layers
    `${SYSTEM_DIR}/migrations`, // For migration metadata
    `${SYSTEM_DIR}/lock`,    // For migration locking
  ];

  for (const dir of subdirs) {
    console.log(`Creating directory ${dir}...`);
    const mkdirResult = await new Deno.Command("mkdir", {
      args: ["-p", dir],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (!mkdirResult.success) {
      const stderr = new TextDecoder().decode(mkdirResult.stderr);
      throw new Error(`Failed to create directory ${dir}: ${stderr}`);
    }

    // Verify directory was created
    const checkResult = await new Deno.Command("test", {
      args: ["-d", dir],
    }).output();

    if (!checkResult.success) {
      throw new Error(`Directory ${dir} was not created successfully`);
    }

    console.log(`Successfully created ${dir}`);
  }

  console.log("System data setup complete");
}

/**
 * Detects if a mount point's source device is accessible
 *
 * Docker creates special mounts for some files (/etc/resolv.conf, etc)
 * that are inaccessible from the container. We need to:
 * 1. Detect these special mounts
 * 2. Copy their contents instead of bind mounting
 * 3. Preserve the special file handling
 */
async function isPrivateMount(mountPath: string): Promise<boolean> {
  // Get device info for this mount
  const findmnt = await new Deno.Command("findmnt", {
    args: ["--json", mountPath],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!findmnt.success) {
    return true; // Assume private if we can't get mount info
  }

  const mounts = JSON.parse(new TextDecoder().decode(findmnt.stdout));
  if (!mounts.filesystems?.[0]?.source) {
    return true; // No source device found
  }

  const source = mounts.filesystems[0].source;

  // Try to stat the source device
  const stat = await new Deno.Command("stat", {
    args: [source],
    stdout: "piped",
    stderr: "piped",
  }).output();

  return !stat.success; // Private if we can't access the source
}

/**
 * Copies a file if its mount point is private
 * Returns true if the file was copied
 */
async function copyIfPrivateMount(path: string, destPath: string): Promise<boolean> {
  console.log(`Checking if ${path} needs to be copied...`);

  if (await isPrivateMount(path)) {
    console.log(`${path} is on a private mount, copying contents...`);

    // Read original contents
    const cat = await new Deno.Command("cat", {
      args: [path],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (!cat.success) {
      throw new Error(`Failed to read ${path}`);
    }

    // Ensure parent directory exists
    const parentDir = destPath.split("/").slice(0, -1).join("/");
    const mkdir = await new Deno.Command("mkdir", {
      args: ["-p", parentDir],
    }).output();

    if (!mkdir.success) {
      throw new Error(`Failed to create directory ${parentDir}`);
    }

    // Write contents to new location
    try {
      await Deno.writeFile(destPath, cat.stdout);
    } catch (error) {
      throw new Error(`Failed to write ${destPath}: ${error}`);
    }

    // Copy permissions
    const mode = await new Deno.Command("stat", {
      args: ["-c", "%a", path],
      stdout: "piped",
    }).output();

    if (mode.success) {
      await new Deno.Command("chmod", {
        args: [new TextDecoder().decode(mode.stdout).trim(), destPath],
      }).output();
    }

    return true;
  }

  console.log(`${path} mount is accessible, no need to copy`);
  return false;
}

/**
 * Creates new root directory and essential mount points
 *
 * The new root setup:
 * 1. Creates a clean mount namespace
 * 2. Preserves essential system mounts
 * 3. Handles Docker's special files
 * 4. Prepares for overlayfs setup
 */
async function setupNewRoot(): Promise<void> {
  console.log("Setting up new root directory...");

  // First create new root directory
  const mkdirResult = await new Deno.Command("mkdir", {
    args: ["-p", NEW_ROOT],
  }).output();

  if (!mkdirResult.success) {
    throw new Error(`Failed to create directory ${NEW_ROOT}`);
  }

  // Show all current mounts before bind mount
  const initialMounts = await new Deno.Command("mount", {
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log("Mounts before bind mount:", new TextDecoder().decode(initialMounts.stdout));

  // Bind mount current root - using --bind to have explicit control over mount propagation
  // We'll handle specific mounts ourselves rather than relying on recursive propagation
  const bindResult = await new Deno.Command("mount", {
    args: ["--bind", "/", NEW_ROOT],
  }).output();

  if (!bindResult.success) {
    throw new Error("Failed to bind mount current root");
  }

  // Check mounts again after bind mount
  const afterBindMounts = await new Deno.Command("mount", {
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log("Mounts after bind mount:", new TextDecoder().decode(afterBindMounts.stdout));

  // Debug: Get complete mount hierarchy in JSON format
  const findmntResult = await new Deno.Command("findmnt", {
    args: ["--json", "/"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log("Complete mount hierarchy after bind mount:", new TextDecoder().decode(findmntResult.stdout));

  // Debug: Check what type of file resolv.conf is and if it's a symlink
  const resolvStat = await new Deno.Command("ls", {
    args: ["-la", "/etc/resolv.conf"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log("Original resolv.conf file info:", new TextDecoder().decode(resolvStat.stdout));

  // Check if it's a symlink and where it points
  const readlink = await new Deno.Command("readlink", {
    args: ["-f", "/etc/resolv.conf"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log("resolv.conf real path:", new TextDecoder().decode(readlink.stdout));

  // Show all current mounts before bind mount
  const mountsBefore = await new Deno.Command("mount", {
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log("Mounts before bind mount:", new TextDecoder().decode(mountsBefore.stdout));

  // Check if resolv.conf exists in new root and what type it is
  const newRootResolv = await new Deno.Command("ls", {
    args: ["-la", `${NEW_ROOT}/etc/resolv.conf`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log("New root resolv.conf file info:", new TextDecoder().decode(newRootResolv.stdout));

  // Check if the new root resolv.conf is a symlink
  const newRootReadlink = await new Deno.Command("readlink", {
    args: ["-f", `${NEW_ROOT}/etc/resolv.conf`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  console.log("New root resolv.conf real path:", new TextDecoder().decode(newRootReadlink.stdout));

  // Debug: Check both files in new root
  try {
    const newRootPasswd = await new Deno.Command("cat", {
      args: [`${NEW_ROOT}/etc/passwd`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    console.log("New root passwd contents:", new TextDecoder().decode(newRootPasswd.stdout));
  } catch (error) {
    console.log("Failed to read files from new root:", error);
  }

  // Create essential mount points that we'll handle explicitly
  const mountPoints = [
    `${NEW_ROOT}/dev`,           // For devtmpfs
    `${NEW_ROOT}/proc`,          // For procfs
    `${NEW_ROOT}/sys`,           // For sysfs
    `${NEW_ROOT}/run`,           // For runtime state
    `${NEW_ROOT}/sys/fs/cgroup`, // For cgroup2
    `${NEW_ROOT}/oldroot`,       // For pivot_root target
    `${NEW_ROOT}/tmp`,           // For temporary files
    `${NEW_ROOT}/data`,          // For persistent data
  ];

  for (const dir of mountPoints) {
    const mkdirResult = await new Deno.Command("mkdir", {
      args: ["-p", dir],
    }).output();

    if (!mkdirResult.success) {
      throw new Error(`Failed to create mount point ${dir}`);
    }
  }

  console.log("New root setup complete");
}

/**
 * Sets up the overlay filesystem on the new root
 *
 * The overlay provides:
 * 1. A writable layer over the read-only base
 * 2. Isolation of system changes
 * 3. Ability to test changes before committing
 * 4. Support for rolling back changes
 */
async function setupOverlay(): Promise<void> {
  console.log("Setting up overlay filesystem...");

  // Debug: Check if directories exist and are accessible
  for (const dir of [NEW_ROOT, `${SYSTEM_DIR}/upper`, `${SYSTEM_DIR}/work`]) {
    console.log(`Checking directory ${dir}...`);
    const statResult = await new Deno.Command("stat", {
      args: [dir],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (!statResult.success) {
      const stderr = new TextDecoder().decode(statResult.stderr);
      console.error(`Failed to stat ${dir}: ${stderr}`);
      throw new Error(`Directory ${dir} is not accessible`);
    }

    const perms = new TextDecoder().decode(statResult.stdout);
    console.log(`${dir} permissions: ${perms}`);
  }

  // Debug: Show current mounts
  console.log("\nCurrent mounts before overlay setup:");
  const beforeMounts = await new Deno.Command("findmnt", {
    args: ["--raw", "--output", "TARGET,SOURCE,FSTYPE,OPTIONS"],
    stdout: "piped",
  }).output();
  console.log(new TextDecoder().decode(beforeMounts.stdout));

  // Debug: Show the exact mount command we're going to run
  const mountCmd = [
    "mount",
    "-t", "overlay",
    "overlay",
    "-o", `lowerdir=${NEW_ROOT},upperdir=${SYSTEM_DIR}/upper,workdir=${SYSTEM_DIR}/work`,
    NEW_ROOT
  ];
  console.log("\nAttempting overlay mount with command:", mountCmd.join(" "));

  // Try the mount with explicit error capture
  const overlayResult = await new Deno.Command("mount", {
    args: mountCmd.slice(1),
    stderr: "piped",
  }).output();

  if (!overlayResult.success) {
    const stderr = new TextDecoder().decode(overlayResult.stderr);
    console.error("\nOverlay mount failed with error:", stderr);

    // Debug: Check dmesg for any kernel messages about the mount
    console.log("\nChecking kernel messages:");
    const dmesg = await new Deno.Command("dmesg", {
      args: ["|", "tail", "-n", "20"],
      stdout: "piped",
    }).output();
    console.log(new TextDecoder().decode(dmesg.stdout));

    // Debug: Show mount points after failure
    console.log("\nMount points after failed attempt:");
    const afterMounts = await new Deno.Command("findmnt", {
      args: ["--raw", "--output", "TARGET,SOURCE,FSTYPE,OPTIONS"],
      stdout: "piped",
    }).output();
    console.log(new TextDecoder().decode(afterMounts.stdout));

    throw new Error(`Failed to mount overlay filesystem: ${stderr}`);
  }

  console.log("Overlay filesystem setup complete");
}

/**
 * Sets up essential system mounts in the new root
 *
 * System mounts are handled carefully to:
 * 1. Preserve necessary kernel interfaces
 * 2. Prevent mount propagation back to host
 * 3. Handle Docker's special cases
 * 4. Maintain security boundaries
 */
async function setupSystemMounts(): Promise<void> {
  console.log("Setting up system mounts...");

  // Essential system mounts that need all their submounts
  const essentialMounts = [
    // /dev is handled specially
    { src: "/proc", dest: `${NEW_ROOT}/proc` },
    { src: "/sys", dest: `${NEW_ROOT}/sys` },
    { src: "/run", dest: `${NEW_ROOT}/run` },
    { src: "/sys/fs/cgroup", dest: `${NEW_ROOT}/sys/fs/cgroup` }
  ];

  // Handle /dev specially since Docker may mount it as tmpfs
  const devMount = `${NEW_ROOT}/dev`;
  const mkdevResult = await new Deno.Command("mkdir", {
    args: ["-p", devMount],
  }).output();

  if (!mkdevResult.success) {
    throw new Error("Failed to create /dev mount point");
  }

  // Check if /dev is already mounted as devtmpfs
  const findmntResult = await new Deno.Command("findmnt", {
    args: ["-n", "-o", "FSTYPE", "/dev"],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const devFsType = new TextDecoder().decode(findmntResult.stdout).trim();

  if (devFsType === "devtmpfs") {
    // If it's already devtmpfs, just bind mount it
    const bindResult = await new Deno.Command("mount", {
      args: ["--rbind", "/dev", devMount],
    }).output();

    if (!bindResult.success) {
      throw new Error("Failed to bind mount /dev");
    }
  } else {
    // Otherwise mount fresh devtmpfs
    const mountResult = await new Deno.Command("mount", {
      args: ["-t", "devtmpfs", "none", devMount],
    }).output();

    if (!mountResult.success) {
      throw new Error("Failed to mount devtmpfs");
    }
  }

  // Make /dev slave to prevent propagation back to host
  const slaveResult = await new Deno.Command("mount", {
    args: ["--make-rslave", devMount],
  }).output();

  if (!slaveResult.success) {
    console.warn("Warning: Failed to make /dev rslave");
  }

  // Handle each essential mount
  for (const mount of essentialMounts) {
    // Create mount point
    const mkdirResult = await new Deno.Command("mkdir", {
      args: ["-p", mount.dest],
    }).output();

    if (!mkdirResult.success) {
      throw new Error(`Failed to create mount point ${mount.dest}`);
    }

    // Bind mount with all submounts
    const bindResult = await new Deno.Command("mount", {
      args: ["--rbind", mount.src, mount.dest],
    }).output();

    if (!bindResult.success) {
      throw new Error(`Failed to bind mount ${mount.src}`);
    }

    // Make mount slave to prevent propagation back to host
    const slaveResult = await new Deno.Command("mount", {
      args: ["--make-rslave", mount.dest],
    }).output();

    if (!slaveResult.success) {
      console.warn(`Warning: Failed to make ${mount.dest} rslave`);
    }
  }

  // Mount /tmp
  const tmpMount = await new Deno.Command("mount", {
    args: ["-t", "tmpfs", "none", `${NEW_ROOT}/tmp`],
  }).output();
  if (!tmpMount.success) {
    throw new Error("Failed to mount /tmp");
  }

  console.log("System mounts setup complete");
}

/**
 * Switch to the new root filesystem using pivot_root
 *
 * pivot_root is used instead of chroot because:
 * 1. It completely detaches from the old root
 * 2. Prevents leaking file descriptors
 * 3. Properly handles mount namespaces
 * 4. Required for systemd compatibility
 */
async function pivotRoot(): Promise<void> {
  console.log("Switching root filesystem...");

  // Execute pivot_root
  const pivotResult = await new Deno.Command("pivot_root", {
    args: [NEW_ROOT, `${NEW_ROOT}/oldroot`],
  }).output();
  if (!pivotResult.success) {
    throw new Error("Failed to pivot_root");
  }

  console.log("Successfully switched root filesystem");
}

/**
 * Hide the old root filesystem by mounting tmpfs over it
 *
 * We hide the old root to:
 * 1. Prevent systemd from scanning it
 * 2. Avoid resource conflicts
 * 3. Maintain clean mount namespace
 * 4. Reduce memory usage
 */
async function hideOldRoot(): Promise<void> {
  console.log("Hiding old root filesystem...");

  // Change to new root first since old cwd may not exist
  try {
    Deno.chdir("/");
  } catch (error) {
    throw new Error(`Failed to change to new root directory: ${error}`);
  }

  // First unmount the old root lazily to avoid "device busy" errors
  const umountResult = await new Deno.Command("umount", {
    args: ["-l", "/oldroot"],
  }).output();
  if (!umountResult.success) {
    throw new Error("Failed to unmount old root");
  }

  // Now mount tmpfs over it to hide it from systemd
  const hideResult = await new Deno.Command("mount", {
    args: ["-t", "tmpfs", "tmpfs", "/oldroot"],
  }).output();
  if (!hideResult.success) {
    throw new Error("Failed to hide old root with tmpfs");
  }

  console.log("Old root filesystem hidden");
}

/**
 * Sets up /data directory, mounting as tmpfs if it's not already mounted as tmpfs
 * This is ONLY for testing purposes
 */
async function setupDataDirectory(): Promise<void> {
  console.log("Checking /data directory setup...");

  // Check if /data is already mounted as tmpfs
  const findmntResult = await new Deno.Command("findmnt", {
    args: ["-n", "-o", "FSTYPE", "/data"],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const fsType = new TextDecoder().decode(findmntResult.stdout).trim();

  if (fsType !== "tmpfs") {
    console.warn("\n⚠️  WARNING: /data is not mounted as tmpfs!");
    console.warn("⚠️  Creating a temporary /data using tmpfs.");
    console.warn("⚠️  This is ONLY suitable for testing!");
    console.warn("⚠️  Production environments MUST mount a persistent volume at /data\n");

    // Create /data if it doesn't exist
    const mkdirResult = await new Deno.Command("mkdir", {
      args: ["-p", "/data"],
    }).output();

    if (!mkdirResult.success) {
      throw new Error("Failed to create /data directory");
    }

    // Mount tmpfs
    const mountResult = await new Deno.Command("mount", {
      args: ["-t", "tmpfs", "-o", "size=1G", "tmpfs", "/data"],
    }).output();

    if (!mountResult.success) {
      throw new Error("Failed to mount tmpfs on /data");
    }

    console.log("Mounted temporary tmpfs at /data for testing");
  } else {
    console.log("/data is already mounted as tmpfs, proceeding");
  }
}

/**
 * Gets the actual underlying directory of the root overlay filesystem
 */
async function getRootOverlayLowerDir(): Promise<string> {
  console.log("Discovering root overlay lower directory...");

  // Use findmnt to get detailed mount info for root
  const findmnt = await new Deno.Command("findmnt", {
    args: ["--json", "/"],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!findmnt.success) {
    throw new Error("Failed to get root mount info");
  }

  const mounts = JSON.parse(new TextDecoder().decode(findmnt.stdout));
  const rootMount = mounts.filesystems?.[0];

  if (!rootMount || rootMount.fstype !== "overlay") {
    throw new Error("Root is not an overlay filesystem");
  }

  // Parse the options to get lowerdir
  const options = rootMount.options as string;
  const optionsMap = new Map(options.split(",").map((opt: string) => {
    const [key, value] = opt.split("=");
    return [key, value];
  }));

  const lowerdir = optionsMap.get("lowerdir");
  if (!lowerdir) {
    throw new Error("Could not find lowerdir in overlay options");
  }

  // The lowerdir option may contain multiple directories separated by ':'
  // We want the first/lowest one
  const lowerdirs = lowerdir.split(":");
  console.log("Found overlay lower directories:", lowerdirs);

  return lowerdirs[0];
}

/**
 * Main mount setup function that orchestrates the entire process
 */
export async function setupMounts(): Promise<void> {
  // Debug: Print resolv.conf and passwd contents before we start
  try {
    // Check what type of file resolv.conf is
    const resolvStat = await new Deno.Command("ls", {
      args: ["-la", "/etc/resolv.conf"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    console.log("resolv.conf file info:", new TextDecoder().decode(resolvStat.stdout));

    const resolvConf = await new Deno.Command("cat", {
      args: ["/etc/resolv.conf"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    console.log("Original /etc/resolv.conf contents:", new TextDecoder().decode(resolvConf.stdout));

    const passwd = await new Deno.Command("cat", {
      args: ["/etc/passwd"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    console.log("Original /etc/passwd contents:", new TextDecoder().decode(passwd.stdout));
  } catch (error) {
    console.log("Failed to read files:", error);
  }

  // Get the actual lower directory before we do anything
  const lowerDir = await getRootOverlayLowerDir();
  console.log("Using root overlay lower directory:", lowerDir);

  // 0. Set up /data directory first if needed
  await setupDataDirectory();

  // 1. Set up system data - provides workspace for overlay
  await setupSystemData();

  // 2. Create and bind mount new root from the actual lower directory
  await setupNewRoot();

  // 3. Set up overlay using the mounted /data/system
  await setupOverlay();

  // 4. Now mount /data into new root after overlay is set up
  const dataMountPoint = `${NEW_ROOT}/data`;
  const mkdirResult = await new Deno.Command("mkdir", {
    args: ["-p", dataMountPoint],
  }).output();
  if (!mkdirResult.success) {
    throw new Error("Failed to create /data mount point");
  }

  const dataMount = await new Deno.Command("mount", {
    args: ["--rbind", "/data", dataMountPoint],
  }).output();
  if (!dataMount.success) {
    throw new Error("Failed to mount /data");
  }

  // 5. Handle Docker's special mounts after overlay is set up
  const specialFiles = [
    "/etc/resolv.conf",
    "/etc/hostname",
    "/etc/hosts"
  ];

  for (const file of specialFiles) {
    await copyIfPrivateMount(file, `${NEW_ROOT}${file}`);
  }

  // 6. Set up state directories after overlay
  for (const statePath of STATE_PATHS) {
    await setupStateDirectory(statePath);
  }

  // 7. Set up system mounts
  await setupSystemMounts();

  // 8. Switch root and hide old root
  await pivotRoot();
  await hideOldRoot();
}

// Run directly if called as script
if (import.meta.main) {
  setupMounts().catch((error) => {
    console.error(error);
    Deno.exit(1);
  });
}
