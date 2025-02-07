import { assertEquals } from "@std/assert";
import { inspect } from "../commands/inspect.ts";

Deno.test("inspect command", async (t) => {
  // Fail fast if not in Docker
  if (!Deno.env.get("INSIDE_DOCKER")) {
    throw new Error("This test must be run inside Docker with INSIDE_DOCKER=1");
  }

  await t.step("check mount output format", async () => {
    // Capture console output
    const originalLog = console.log;
    const originalError = console.error;
    const logs: string[] = [];
    
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const result = await inspect([]);
      assertEquals(result, 0, "inspect command should exit with 0");
      
      // Verify output format
      const output = logs.join("\n");
      
      // Check for required sections
      assertEquals(output.includes("=== OverlayFS Mounts ==="), true, "Should show overlay mounts section");
      assertEquals(output.includes("=== Tmpfs Mounts ==="), true, "Should show tmpfs mounts section");
      assertEquals(output.includes("=== Proc Mounts ==="), true, "Should show proc mounts section");
      
      // At least one mount should be found (we know overlay is used)
      assertEquals(
        output.includes("No overlay mounts found"),
        false,
        "At least one overlay mount should be found"
      );

      // Verify mount format for different types
      assertEquals(
        output.includes("(overlay)"),
        true,
        "Overlay mounts should show filesystem type"
      );
      assertEquals(
        output.includes(" on "),
        true,
        "Non-overlay mounts should show device and mountpoint"
      );
    } finally {
      // Restore console
      console.log = originalLog;
      console.error = originalError;
    }
  });
}); 