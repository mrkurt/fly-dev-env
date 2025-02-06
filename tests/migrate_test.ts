import { assertEquals } from "@std/assert";
import { runCommand } from "./helpers/cmd.ts";

Deno.test("overlayfs hello world", async (t) => {
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

  await t.step("verify overlay functionality", async () => {
    // Test 1: Write a test file
    console.log("\nWriting test file to system directory...");
    const writeResult = await runCommand("sh", [
      "-c",
      "echo 'Hello from test' > /data/system/test.txt",
    ]);
    assertEquals(writeResult.success, true, "Failed to write test file");

    // Test 2: Read the file back
    console.log("\nReading test file...");
    const readResult = await runCommand("cat", ["/data/system/test.txt"]);
    assertEquals(readResult.success, true, "Failed to read test file");
    assertEquals(
      readResult.stdout.trim(),
      "Hello from test",
      "Incorrect content in test file",
    );
    console.log("✓ Successfully wrote and read file in system directory");

    // Test 3: Write to state directory
    console.log("\nWriting test file to state directory...");
    const stateResult = await runCommand("sh", [
      "-c",
      "echo 'Hello from state' > /data/state/test.txt",
    ]);
    assertEquals(stateResult.success, true, "Failed to write to state directory");

    // Test 4: Verify both files exist with correct content
    const systemContent = await runCommand("cat", ["/data/system/test.txt"]);
    const stateContent = await runCommand("cat", ["/data/state/test.txt"]);
    
    assertEquals(
      systemContent.stdout.trim(),
      "Hello from test",
      "System file content changed",
    );
    assertEquals(
      stateContent.stdout.trim(),
      "Hello from state",
      "State file content incorrect",
    );
    console.log("✓ Successfully verified system and state separation");
  });
}); 