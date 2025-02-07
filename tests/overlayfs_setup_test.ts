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

  await t.step("verify system tmpfs mount", async () => {
    console.log("\nVerifying system tmpfs mount...");
    const mounts = await getMounts();
    const systemMount = findMount(mounts, "/data/system");

    assertEquals(systemMount?.fsType, "tmpfs", "System dir should be tmpfs");
    assertEquals(
      systemMount?.options.some((opt) => opt.startsWith("size=") && parseInt(opt.split("=")[1]) >= 1048576),
      true,
      "System tmpfs should be at least 1G"
    );

    // Verify required directories exist
    const dirs = [
      "/data/system/upper",
      "/data/system/work",
      "/data/system/layers",
      "/data/system/migrations",
      "/data/system/lock"
    ];

    for (const dir of dirs) {
      const result = await runCommand("test", ["-d", dir]);
      assertEquals(result.success, true, `Directory ${dir} should exist`);
    }

    console.log("✓ System tmpfs configured correctly");
  });

  await t.step("verify new root setup", async () => {
    console.log("\nVerifying new root setup...");

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
      "/",
      "Root overlay should use / as lowerdir"
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

    // Verify essential system mounts
    const requiredMounts = [
      { point: "/dev", type: "devtmpfs" },
      { point: "/proc", type: "proc" },
      { point: "/sys", type: "sysfs" },
      { point: "/run", type: "tmpfs" },
      { point: "/sys/fs/cgroup", type: "cgroup2" }
    ];

    for (const req of requiredMounts) {
      const mount = findMount(mounts, req.point);
      assertEquals(
        mount?.fsType,
        req.type,
        `${req.point} should be mounted as ${req.type}`
      );
    }

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
