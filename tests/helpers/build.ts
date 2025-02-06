#!/usr/bin/env -S deno run --allow-run

/**
 * Build a test container image
 */
export async function buildTestContainer(name: string): Promise<void> {
  // Convert name to lowercase and remove any invalid characters for Docker tags
  const imageName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  console.log(`Building test container ${name}...`);
  
  const buildCmd = new Deno.Command("docker", {
    args: [
      "build",
      "--platform", "linux/arm64",
      "-t", `${imageName}-test:latest`,
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