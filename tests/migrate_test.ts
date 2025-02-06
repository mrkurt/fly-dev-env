import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { buildImage, startContainer } from "$lib/docker.ts";

const TEST_IMAGE = "system-migrate-test:latest";

Deno.test("overlayfs hello world", async (t) => {
  // Build test container
  const testDir = dirname(fromFileUrl(import.meta.url));
  const dockerfilePath = join(testDir, "fixtures", "Dockerfile.test");
  
  await t.step("build test image", async () => {
    await buildImage(dockerfilePath, TEST_IMAGE);
  });

  // Start container
  const container = await startContainer(TEST_IMAGE, {
    privileged: true,
    workdir: "/test",
  });

  try {
    await t.step("mount overlayfs", async () => {
      const result = await container.exec([
        "mount",
        "-t", "overlay",
        "overlay",
        "-o", "lowerdir=/test/lower,upperdir=/test/upper,workdir=/test/work",
        "/test/merged",
      ]);
      assertEquals(result.success, true, "Failed to mount overlayfs");
    });

    await t.step("verify lower layer content", async () => {
      const result = await container.exec(["cat", "/test/merged/test.txt"]);
      assertEquals(result.success, true);
      assertEquals(
        result.stdout.trim(),
        "Hello from lower layer",
        "Unexpected content in merged view",
      );
    });

    await t.step("write to upper layer", async () => {
      const result = await container.exec([
        "sh",
        "-c",
        "echo 'Hello from upper layer' > /test/merged/new.txt",
      ]);
      assertEquals(result.success, true, "Failed to write to merged view");
    });

    await t.step("verify changes", async () => {
      // Check the file exists in merged view
      const mergedResult = await container.exec(["cat", "/test/merged/new.txt"]);
      assertEquals(mergedResult.success, true);
      assertEquals(
        mergedResult.stdout.trim(),
        "Hello from upper layer",
        "Unexpected content in merged view",
      );

      // Verify the file is in upper layer
      const upperResult = await container.exec(["cat", "/test/upper/new.txt"]);
      assertEquals(upperResult.success, true);
      assertEquals(
        upperResult.stdout.trim(),
        "Hello from upper layer",
        "File not found in upper layer",
      );

      // Verify the file is not in lower layer
      const lowerResult = await container.exec(["test", "-f", "/test/lower/new.txt"]);
      assertEquals(lowerResult.success, false, "File should not exist in lower layer");
    });
  } finally {
    // Cleanup
    await container.cleanup();
  }
}); 