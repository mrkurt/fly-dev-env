#!/usr/bin/env -S deno run --allow-run

/**
 * Run a test container
 */
export async function runTestContainer(name: string): Promise<void> {
  const args = [
    "run",
    "--rm",
    "--privileged",
    `${name}:latest`,
  ];

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
  if (Deno.args.length === 0) {
    console.error("Usage: run.ts <container-name>");
    Deno.exit(1);
  }

  await runTestContainer(Deno.args[0]);
} 