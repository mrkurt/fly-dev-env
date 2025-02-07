import { runCommand } from "../tests/helpers/cmd.ts";

// Configuration constants
const SYSTEM_DIR = "/data/system";
const SYSTEM_SIZE = "1G";
const NEW_ROOT = "/mnt/newroot";
const STATE_DIR = "/data/state";

// State directories that need to be persisted
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
 * This ensures any existing files are preserved when we mount the state directory
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
 * This is the first mount we need - it provides the writable layer for our overlay
 */
async function setupSystemData(): Promise<void> {
  console.log("Setting up system data...");

  // Create system directory
  const mkdirResult = await new Deno.Command("mkdir", {
    args: ["-p", SYSTEM_DIR],
  }).output();

  if (!mkdirResult.success) {
    throw new Error(`Failed to create directory ${SYSTEM_DIR}`);
  }

  // Mount tmpfs for system data
  const mountResult = await new Deno.Command("mount", {
    args: [
      "-t", "tmpfs",
      "-o", `size=${SYSTEM_SIZE}`,
      "tmpfs",
      SYSTEM_DIR
    ],
  }).output();

  if (!mountResult.success) {
    throw new Error("Failed to mount system tmpfs");
  }

  // Create required directories under tmpfs
  const subdirs = [
    `${SYSTEM_DIR}/upper`,   // For overlay upper layer
    `${SYSTEM_DIR}/work`,    // For overlay work directory
    `${SYSTEM_DIR}/layers`,  // For tracking overlay layers
    `${SYSTEM_DIR}/migrations`, // For migration metadata
    `${SYSTEM_DIR}/lock`,    // For migration locking
  ];

  for (const dir of subdirs) {
    const mkdirResult = await new Deno.Command("mkdir", {
      args: ["-p", dir],
    }).output();

    if (!mkdirResult.success) {
      throw new Error(`Failed to create directory ${dir}`);
    }
  }

  console.log("System data setup complete");
}

/**
 * Creates new root directory and essential mount points
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

  // Bind mount current root
  const bindResult = await new Deno.Command("mount", {
    args: ["--bind", "/", NEW_ROOT],
  }).output();

  if (!bindResult.success) {
    throw new Error("Failed to bind mount current root");
  }

  // Set up state directories before overlay
  for (const statePath of STATE_PATHS) {
    await setupStateDirectory(statePath);
  }

  // Now create remaining essential mount points
  const mountPoints = [
    `${NEW_ROOT}/dev`,           // For devtmpfs
    `${NEW_ROOT}/proc`,          // For procfs
    `${NEW_ROOT}/sys`,           // For sysfs
    `${NEW_ROOT}/run`,           // For runtime state
    `${NEW_ROOT}/sys/fs/cgroup`, // For cgroup2
    `${NEW_ROOT}/oldroot`,       // For pivot_root target
    `${NEW_ROOT}/tmp`,           // For temporary files
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
 */
async function setupOverlay(): Promise<void> {
  console.log("Setting up overlay filesystem...");

  // Mount overlay using current root as lower layer
  const overlayResult = await new Deno.Command("mount", {
    args: [
      "-t", "overlay",
      "overlay",
      "-o", `lowerdir=/,upperdir=${SYSTEM_DIR}/upper,workdir=${SYSTEM_DIR}/work`,
      NEW_ROOT
    ],
  }).output();

  if (!overlayResult.success) {
    throw new Error("Failed to mount overlay filesystem");
  }

  console.log("Overlay filesystem setup complete");
}

/**
 * Sets up essential system mounts in the new root
 */
async function setupSystemMounts(): Promise<void> {
  console.log("Setting up system mounts...");

  // Mount /run as tmpfs and copy runtime state
  const runMount = await new Deno.Command("mount", {
    args: ["-t", "tmpfs", "-o", "mode=0755", "tmpfs", `${NEW_ROOT}/run`],
  }).output();
  if (!runMount.success) {
    throw new Error("Failed to mount /run");
  }

  // Copy runtime state
  const copyRun = await new Deno.Command("cp", {
    args: ["-a", "/run/.", `${NEW_ROOT}/run/`],
  }).output();
  if (!copyRun.success) {
    console.warn("Warning: Failed to copy /run state");
  }

  // Mount /dev as devtmpfs
  const devMount = await new Deno.Command("mount", {
    args: ["-t", "devtmpfs", "none", `${NEW_ROOT}/dev`],
  }).output();
  if (!devMount.success) {
    throw new Error("Failed to mount /dev");
  }

  // Make /dev rslave
  const devSlave = await new Deno.Command("mount", {
    args: ["--make-rslave", `${NEW_ROOT}/dev`],
  }).output();
  if (!devSlave.success) {
    throw new Error("Failed to make /dev rslave");
  }

  // Mount /proc and make it rslave
  const procMount = await new Deno.Command("mount", {
    args: ["--rbind", "/proc", `${NEW_ROOT}/proc`],
  }).output();
  if (!procMount.success) {
    throw new Error("Failed to mount /proc");
  }
  const procSlave = await new Deno.Command("mount", {
    args: ["--make-rslave", `${NEW_ROOT}/proc`],
  }).output();
  if (!procSlave.success) {
    throw new Error("Failed to make /proc rslave");
  }

  // Mount /sys and make it rslave
  const sysMount = await new Deno.Command("mount", {
    args: ["--rbind", "/sys", `${NEW_ROOT}/sys`],
  }).output();
  if (!sysMount.success) {
    throw new Error("Failed to mount /sys");
  }
  const sysSlave = await new Deno.Command("mount", {
    args: ["--make-rslave", `${NEW_ROOT}/sys`],
  }).output();
  if (!sysSlave.success) {
    throw new Error("Failed to make /sys rslave");
  }

  // Mount cgroup2 and make it rslave
  const cgroupMount = await new Deno.Command("mount", {
    args: ["-t", "cgroup2", "none", `${NEW_ROOT}/sys/fs/cgroup`],
  }).output();
  if (!cgroupMount.success) {
    throw new Error("Failed to mount cgroup2");
  }
  const cgroupSlave = await new Deno.Command("mount", {
    args: ["--make-rslave", `${NEW_ROOT}/sys/fs/cgroup`],
  }).output();
  if (!cgroupSlave.success) {
    throw new Error("Failed to make cgroup2 rslave");
  }

  // Mount /data and make it rslave to ensure state persistence
  const dataMount = await new Deno.Command("mount", {
    args: ["--rbind", "/data", `${NEW_ROOT}/data`],
  }).output();
  if (!dataMount.success) {
    throw new Error("Failed to mount /data");
  }
  const dataSlave = await new Deno.Command("mount", {
    args: ["--make-rslave", `${NEW_ROOT}/data`],
  }).output();
  if (!dataSlave.success) {
    throw new Error("Failed to make /data rslave");
  }

  // Mount /tmp
  const tmpMount = await new Deno.Command("mount", {
    args: ["--bind", "/tmp", `${NEW_ROOT}/tmp`],
  }).output();
  if (!tmpMount.success) {
    throw new Error("Failed to mount /tmp");
  }

  console.log("System mounts setup complete");
}

/**
 * Switch to the new root filesystem using pivot_root
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
 * This prevents systemd from scanning the old root
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
 * Main mount setup function that orchestrates the entire process
 */
export async function setupMounts(): Promise<void> {
  await setupSystemData();
  await setupNewRoot();
  // Set up state directories before overlay
  for (const statePath of STATE_PATHS) {
    await setupStateDirectory(statePath);
  }
  await setupOverlay();
  await setupSystemMounts();
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
