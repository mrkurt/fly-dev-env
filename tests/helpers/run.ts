#!/usr/bin/env -S deno run --allow-run

import { parseArgs } from "@std/cli";
import { buildTestContainer } from "./build.ts";

interface RunOptions {
  shouldBuild?: boolean;
}

/**
 * Run a test container
 */
export async function runTestContainer(name: string, cmd?: string[], options: RunOptions = {}): Promise<void> {
  // Build first if requested
  if (options.shouldBuild) {
    await buildTestContainer(name);
  }

  // Hardcode image name for consistency
  const imageName = "system-migrate-test";

  const args = [
    "run",
    "--rm",
    "--privileged",
    `${imageName}:latest`,
  ];

  // If cmd is provided, run it through deno mod.ts
  if (cmd && cmd.length > 0) {
    // Filter out the -- if present
    const filteredCmd = cmd.filter(arg => arg !== "--");
    args.push("/bin/sh", "-c", "cd /app && deno run --allow-all mod.ts " + filteredCmd.join(" "));
  }

  console.log(`Running test container ${name}...`);
  console.log(`docker ${args.join(" ")}`);

  const runCmd = new Deno.Command("docker", {
    args,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const result = await runCmd.output();
  if (!result.success) {
    throw new Error(`Failed to run test container ${name}`);
  }
}

// When run directly, run the specified container
if (import.meta.main) {
  // Parse --build flag
  const buildFlag = "--build";
  const args = Deno.args;
  const shouldBuild = args.includes(buildFlag);
  const filteredArgs = args.filter(arg => arg !== buildFlag);

  // First arg is container name, rest are optional command args
  const [name, ...cmd] = filteredArgs;
  if (!name) {
    console.error("Usage: run.ts [--build] <container-name> [cmd...]");
    Deno.exit(1);
  }

  await runTestContainer(name, cmd.length > 0 ? cmd : undefined, { shouldBuild });
}
