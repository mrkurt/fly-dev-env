import { assertEquals } from "@std/assert";
import { runCommand } from "./helpers/cmd.ts";

Deno.test("overlayfs hello world", async (t) => {
  // Fail fast if not in Docker
  if (!Deno.env.get("INSIDE_DOCKER")) {
    throw new Error("This test must be run inside Docker with INSIDE_DOCKER=1");
  }

  // Track if we need cleanup
  let needsCleanup = false;

  try {
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

    await t.step("prepare mount points", async () => {
      console.log("\nSetting up test directory structure...");
      
      // Mount tmpfs for all test directories
      console.log("Mounting tmpfs at /test...");
      const mountResult = await runCommand("mount", ["-t", "tmpfs", "tmpfs", "/test"]);
      assertEquals(mountResult.success, true, "Failed to mount tmpfs at /test");
      needsCleanup = true;
      
      // Create required directories
      console.log("Creating test directories...");
      await runCommand("mkdir", ["-p", "/test/lower", "/test/upper", "/test/work", "/test/merged"]);
      await runCommand("chmod", ["777", "/test/lower", "/test/upper", "/test/work", "/test/merged"]);
      
      // Add test file to lower dir
      console.log("Creating test file in lower layer...");
      await runCommand("sh", ["-c", "echo 'Hello from lower layer' > /test/lower/test.txt"]);

      // Verify directory structure
      console.log("\nVerifying directory structure:");
      const lsResult = await runCommand("ls", ["-la", "/test"]);
      console.log(lsResult.stdout);

      // Verify each directory exists and has correct permissions
      const dirs = ["/test/lower", "/test/upper", "/test/work", "/test/merged"];
      for (const dir of dirs) {
        const result = await runCommand("test", ["-d", dir]);
        assertEquals(result.success, true, `Directory ${dir} does not exist or is not accessible`);
        
        const statResult = await runCommand("stat", ["-c", "%a", dir]);
        assertEquals(
          statResult.stdout.trim(),
          "777",
          `Directory ${dir} does not have 777 permissions`,
        );
      }

      // Verify lower dir has our test file
      const lowerResult = await runCommand("cat", ["/test/lower/test.txt"]);
      assertEquals(
        lowerResult.success,
        true,
        "Test file not created successfully in lower layer",
      );
      
      // Verify work dir exists with correct permissions
      const workResult = await runCommand("test", ["-d", "/test/work"]);
      assertEquals(
        workResult.success,
        true,
        "Work directory does not exist or is not accessible",
      );
    });

    await t.step("mount overlayfs", async () => {
      console.log("\nMounting overlay filesystem...");
      const result = await runCommand("mount", [
        "-t", "overlay",
        "overlay",
        "-o", "lowerdir=/test/lower,upperdir=/test/upper,workdir=/test/work",
        "/test/merged",
      ]);

      if (!result.success) {
        console.log("\nOverlay mount failed. Checking kernel messages:");
        const dmesgResult = await runCommand("sh", ["-c", "dmesg | tail -20"]);
        console.log(dmesgResult.stdout);
        
        console.log("\nCurrent mounts:");
        const mountResult = await runCommand("mount", []);
        console.log(mountResult.stdout);
        
        throw new Error(`Failed to mount overlayfs: ${result.stderr}`);
      }

      console.log("✓ Overlay filesystem mounted successfully");
    });

    await t.step("verify overlay functionality", async () => {
      // Test 1: Read from lower layer through merge
      console.log("\nVerifying read access through overlay...");
      const readResult = await runCommand("cat", ["/test/merged/test.txt"]);
      assertEquals(readResult.success, true, "Failed to read existing file through overlay");
      assertEquals(
        readResult.stdout.trim(),
        "Hello from lower layer",
        "Incorrect content when reading through overlay",
      );
      console.log("✓ Successfully read file from lower layer through overlay");

      // Test 2: Write new file
      console.log("\nTesting write through overlay...");
      const writeResult = await runCommand("sh", [
        "-c",
        "echo 'Hello from upper layer' > /test/merged/new.txt",
      ]);
      assertEquals(writeResult.success, true, "Failed to write new file through overlay");
      console.log("✓ Successfully wrote new file through overlay");

      // Test 3: Verify file locations
      console.log("\nVerifying overlay behavior...");
      
      // Check merged view
      const mergedResult = await runCommand("cat", ["/test/merged/new.txt"]);
      assertEquals(
        mergedResult.stdout.trim(),
        "Hello from upper layer",
        "Incorrect content in merged view",
      );

      // Check upper layer
      const upperResult = await runCommand("cat", ["/test/upper/new.txt"]);
      assertEquals(
        upperResult.success,
        true,
        "New file not found in upper layer - overlay write failed",
      );
      assertEquals(
        upperResult.stdout.trim(),
        "Hello from upper layer",
        "Incorrect content in upper layer",
      );

      // Verify lower layer unchanged
      const lowerResult = await runCommand("test", ["-f", "/test/lower/new.txt"]);
      assertEquals(
        lowerResult.success,
        false,
        "New file appeared in lower layer - overlay is not working correctly",
      );
      
      console.log("✓ Overlay filesystem working as expected");
    });

  } finally {
    if (needsCleanup) {
      console.log("\nCleaning up test environment...");
      
      // Unmount overlay first
      await runCommand("umount", ["/test/merged"]).catch(console.error);
      
      // Then unmount tmpfs
      await runCommand("umount", ["/test"]).catch(console.error);
      
      console.log("Cleanup complete");
    }
  }
}); 