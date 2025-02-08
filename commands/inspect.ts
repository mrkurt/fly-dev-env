import { runCommand } from "../tests/helpers/cmd.ts";
import { parseArgs } from "@std/cli";

// System inspection tool for Fly.io development environments
//
// This tool provides visibility into the layered filesystem by:
// 1. Showing current mount structure
// 2. Identifying overlay layers
// 3. Exposing mount options
// 4. Helping debug mount issues
//
// The output format is designed to be:
// - Human readable for interactive use
// - Parseable for automation
// - Consistent across environments

interface MountInfo {
  device: string;
  mountPoint: string;
  fsType: string;
  options: string[];
}

/**
 * Parse /proc/mounts to get mount information
 */
async function getMounts(): Promise<MountInfo[]> {
  const result = await runCommand("cat", ["/proc/mounts"]);
  if (!result.success) {
    throw new Error("Failed to read /proc/mounts");
  }

  return result.stdout.split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [device, mountPoint, fsType, options] = line.split(" ");
      return {
        device: decodeURIComponent(device),
        mountPoint: decodeURIComponent(mountPoint),
        fsType,
        options: options.split(","),
      };
    });
}

/**
 * Format mount info in a clean way
 */
function formatMount(mount: MountInfo): string {
  // For overlayfs, show full details since they're important
  if (mount.fsType === "overlay") {
    return `${mount.mountPoint} (overlay)`;
  }
  // For other mounts, show device and mount point
  return `${mount.device} on ${mount.mountPoint}`;
}

/**
 * Main inspect command - shows mount information organized by type
 */
export async function inspect(args: string[]): Promise<number> {
  // Parse command line arguments
  const flags = parseArgs(args, {
    boolean: ["json"],
    default: { json: false },
  });

  try {
    const mounts = await getMounts();

    // Output in requested format
    if (flags.json) {
      // JSON output for scripting and automation
      console.log(JSON.stringify(mounts, null, 2));
    } else {
      // Split mounts by type
      const overlayMounts = mounts.filter(mount => mount.fsType === "overlay");
      const tmpfsMounts = mounts.filter(mount => mount.fsType === "tmpfs");
      const procMounts = mounts.filter(mount => mount.fsType === "proc");
      const sysfsMounts = mounts.filter(mount => mount.fsType === "sysfs");
      const otherMounts = mounts.filter(mount =>
        !["overlay", "tmpfs", "proc", "sysfs"].includes(mount.fsType)
      );

      // Show overlay mounts first as they're most important
      console.log("=== OverlayFS Mounts ===");
      if (overlayMounts.length === 0) {
        console.log("No overlay mounts found");
      } else {
        overlayMounts.forEach(mount => console.log(formatMount(mount)));
      }

      // Show tmpfs mounts
      console.log("\n=== Tmpfs Mounts ===");
      if (tmpfsMounts.length === 0) {
        console.log("No tmpfs mounts found");
      } else {
        tmpfsMounts.forEach(mount => console.log(formatMount(mount)));
      }

      // Show proc mounts
      console.log("\n=== Proc Mounts ===");
      if (procMounts.length === 0) {
        console.log("No proc mounts found");
      } else {
        procMounts.forEach(mount => console.log(formatMount(mount)));
      }

      // Show sysfs mounts
      console.log("\n=== Sysfs Mounts ===");
      if (sysfsMounts.length === 0) {
        console.log("No sysfs mounts found");
      } else {
        sysfsMounts.forEach(mount => console.log(formatMount(mount)));
      }

      // Show other mounts
      if (otherMounts.length > 0) {
        console.log("\n=== Other Mounts ===");
        otherMounts.forEach(mount => console.log(`${formatMount(mount)} (${mount.fsType})`));
      }
    }
    return 0;
  } catch (error: unknown) {
    console.error("Error inspecting mounts:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// Run directly if called as script
if (import.meta.main) {
  try {
    await inspect(Deno.args);
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }
}
