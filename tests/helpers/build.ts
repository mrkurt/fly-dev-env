#!/usr/bin/env -S deno run --allow-run

/**
 * Build a test container image
 */
export async function buildTestContainer(name: string): Promise<void> {
  // Hardcode image name for consistency
  const imageName = "system-migrate-test";

  console.log(`Building test container ${name}...`);
  
  const buildCmd = new Deno.Command("docker", {
    args: [
      "build",
      "-t", `${imageName}:latest`,
      "-f", "Dockerfile.test",
      ".",
    ],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const result = await buildCmd.output();
  if (!result.success) {
    throw new Error(`Failed to build test container ${name}`);
  }
}

// When run directly, build all test containers
if (import.meta.main) {
  // For now we just have one container
  await buildTestContainer("system-migrate");
} 