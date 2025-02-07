import { assertEquals, assertMatch } from "@std/assert";
import { runCommand } from "./helpers/cmd.ts";

interface MountInfo {
  device: string;
  mountPoint: string;
  fsType: string;
  options: string[];
}

interface FindmntMount {
  target: string;
  source: string;
  fstype: string;
  options: string;
}

/**
 * Parse /proc/mounts to get mount information
 */
async function getMounts(): Promise<MountInfo[]> {
  const result = await runCommand("cat", ["/proc/mounts"]);
  assertEquals(result.success, true, "Failed to read /proc/mounts");

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
 * Find a specific mount by mount point
 */
function findMount(mounts: MountInfo[], mountPoint: string): MountInfo | undefined {
  return mounts.find((m) => m.mountPoint === mountPoint);
}

Deno.test("overlayfs setup verification", async (t) => {
  // Fail fast if not in Docker
  if (!Deno.env.get("INSIDE_DOCKER")) {
    throw new Error("This test must be run inside Docker with INSIDE_DOCKER=1");
  }

  await t.step("check overlayfs support", async () => {
    console.log("\nVerifying overlayfs kernel support...");
    const result = await runCommand("grep", ["overlay", "/proc/filesystems"]);
    assertEquals(result.success, true, "Failed to check for overlayfs support");
    assertEquals(
      result.stdout.includes("overlay"),
      true,
      "Overlay filesystem not supported by this kernel - ensure overlay module is loaded",
    );
    console.log("✓ Overlayfs is supported by kernel");
  });

  await t.step("verify system data setup", async () => {
    console.log("\nVerifying system data setup...");

    // Check that required directories exist and are writable
    const dirs = [
      "/data/system/upper",   // For overlay upper layer
      "/data/system/work",    // For overlay work directory
      "/data/system/layers",  // For tracking overlay layers
      "/data/system/migrations", // For migration metadata
      "/data/system/lock"     // For migration locking
    ];

    for (const dir of dirs) {
      const exists = await runCommand("test", ["-d", dir]);
      assertEquals(exists.success, true, `Directory ${dir} should exist`);

      // Try to write a test file to verify directory is writable
      const writeTest = await runCommand("sh", ["-c", `echo test > ${dir}/.write-test && rm ${dir}/.write-test`]);
      assertEquals(writeTest.success, true, `Directory ${dir} should be writable`);
    }

    console.log("✓ System data directories verified");
  });

  await t.step("verify new root setup", async () => {
    console.log("\nVerifying new root setup...");

    // Print original resolv.conf contents
    const origResolv = await runCommand("cat", ["/etc/resolv.conf"]);
    console.log("Original resolv.conf contents:", origResolv.stdout);

    // Debug: List /etc contents
    const etcList = await runCommand("ls", ["-la", "/etc/"]);
    console.log("/etc contents:", etcList.stdout);

    // Print new root resolv.conf contents
    const newResolv = await runCommand("cat", ["/mnt/newroot/etc/resolv.conf"]);
    console.log("New root resolv.conf contents:", newResolv.stdout);

    // Debug: Check if /sys/kernel/address_bits exists before pivot_root
    const osReleaseCheck = await runCommand("ls", ["-l", "/sys/kernel/address_bits"]);
    console.log("Original /sys/kernel/address_bits:", osReleaseCheck.stdout);
    const osReleaseContent = await runCommand("cat", ["/sys/kernel/address_bits"]);
    console.log("Original /sys/kernel/address_bits content:", osReleaseContent.stdout);

    // Verify essential mount points exist
    const mountPoints = [
      "/dev",
      "/proc",
      "/sys",
      "/run",
      "/sys/fs/cgroup",
      "/oldroot",
      "/home",
      "/data",
      "/tmp"
    ];

    for (const dir of mountPoints) {
      const result = await runCommand("test", ["-d", dir]);
      assertEquals(result.success, true, `Mount point ${dir} should exist`);
    }

    // Verify resolv.conf exists and is readable
    const resolvConf = await runCommand("test", ["-r", "/etc/resolv.conf"]);
    assertEquals(resolvConf.success, true, "/etc/resolv.conf should exist and be readable");

    // Print resolv.conf contents for debugging
    const catResolv = await runCommand("cat", ["/etc/resolv.conf"]);
    console.log("resolv.conf contents:", catResolv.stdout);

    console.log("✓ New root setup configured correctly");
  });

  await t.step("verify overlay mount", async () => {
    console.log("\nVerifying overlay mount...");

    // Use findmnt to get detailed mount info for our specific mount point
    const findmntResult = await runCommand("findmnt", ["-J", "/"]);
    assertEquals(findmntResult.success, true, "Failed to get mount info for root");

    const mountInfo = JSON.parse(findmntResult.stdout);
    const mounts: FindmntMount[] = mountInfo.filesystems;

    // Debug output
    console.log("Found mounts at root:");
    console.log(JSON.stringify(mounts, null, 2));

    // Find our specific overlay mount by checking the upperdir option
    const ourMount = mounts.find(m =>
      m.fstype === "overlay" &&
      m.options.includes("upperdir=/data/system/upper")
    );

    assertEquals(
      ourMount !== undefined,
      true,
      "Should find our overlay mount with upperdir=/data/system/upper"
    );

    // After asserting ourMount exists, we can use it safely
    if (!ourMount) {
      throw new Error("Mount not found - this should not happen due to previous assertion");
    }

    // Parse the comma-separated options into a map
    const optionsMap = new Map<string, string>(
      ourMount.options.split(",")
        .map(opt => {
          const [key, value] = opt.split("=");
          return value ? [key, value] as [string, string] : null;
        })
        .filter((entry): entry is [string, string] => entry !== null)
    );

    // Verify overlay configuration
    assertEquals(
      optionsMap.get("lowerdir"),
      "/mnt/newroot",
      "Root overlay should use /mnt/newroot as lowerdir"
    );
    assertEquals(
      optionsMap.get("upperdir"),
      "/data/system/upper",
      "Root overlay should use /data/system/upper as upperdir"
    );
    assertEquals(
      optionsMap.get("workdir"),
      "/data/system/work",
      "Root overlay should use /data/system/work as workdir"
    );

    console.log("✓ Overlay mount configured correctly");
  });

  await t.step("verify state directory setup", async () => {
    console.log("\nVerifying state directory setup...");

    // Check that state directories exist and are mounted
    const stateDirs = [
      "/data/state/home",
      "/data/state/var/lib"
    ];

    for (const dir of stateDirs) {
      const result = await runCommand("test", ["-d", dir]);
      assertEquals(result.success, true, `State directory ${dir} should exist`);
    }

    // Verify the timestamp file exists and is recent
    const timestampFile = "/data/state/home/state-configured-at";
    const catResult = await runCommand("cat", [timestampFile]);
    assertEquals(catResult.success, true, "State configuration timestamp should exist");

    const timestamp = new Date(catResult.stdout.trim());
    const now = new Date();
    const ageInSeconds = (now.getTime() - timestamp.getTime()) / 1000;

    assertEquals(
      ageInSeconds < 60,
      true,
      `State configuration timestamp should be recent (was ${ageInSeconds} seconds ago)`
    );

    console.log("✓ State directory setup verified");
  });

  await t.step("verify system mounts and pivot_root", async () => {
    console.log("\nVerifying system mounts and pivot_root...");

    // Get all current mounts
    const mounts = await getMounts();

    // Debug output
    console.log("Current mounts:");
    for (const mount of mounts) {
      console.log(`${mount.mountPoint} (${mount.fsType})`);
    }

    // Verify essential mount functionality

    // /dev - Check if null device exists and is writable
    const devNull = await runCommand("dd", ["if=/dev/zero", "of=/dev/null", "count=1", "bs=1"]);
    assertEquals(devNull.success, true, "/dev/null should be writable");

    // /proc - Check if we can read process info
    const procStat = await runCommand("cat", ["/proc/stat"]);
    assertEquals(procStat.success, true, "/proc/stat should be readable");

    // /sys - Check if we can read kernel info
    const sysKernel = await runCommand("cat", ["/sys/kernel/address_bits"]);
    assertEquals(sysKernel.success, true, "/sys/kernel/address_bits should be readable");

    // /run - Check if we can write to it
    const runTest = await runCommand("sh", ["-c", "echo test > /run/mount-test && rm /run/mount-test"]);
    assertEquals(runTest.success, true, "/run should be writable");

    // /sys/fs/cgroup - Check if we can read cgroup info
    const cgroupInfo = await runCommand("cat", ["/sys/fs/cgroup/cgroup.controllers"]);
    assertEquals(cgroupInfo.success, true, "cgroup2 hierarchy should be accessible");

    // Verify /oldroot is hidden with tmpfs after pivot_root
    const oldRoot = findMount(mounts, "/oldroot");
    assertEquals(
      oldRoot?.fsType,
      "tmpfs",
      "/oldroot should be hidden with tmpfs"
    );

    // Verify we can write directly to stdout/stderr
    const writeTest = await runCommand("sh", [
      "-c",
      "echo 'test' > /proc/self/fd/1 && echo 'test' > /proc/self/fd/2"
    ]);
    assertEquals(
      writeTest.success,
      true,
      "Should be able to write directly to fd1/fd2"
    );

    console.log("✓ System mounts and pivot_root verified");
  });
});
