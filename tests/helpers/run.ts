#!/usr/bin/env -S deno run --allow-run

/**
 * Run a test container
 */
export async function runTestContainer(name: string, cmd?: string[]): Promise<void> {
  const args = [
    "run",
    "--rm",
    "--privileged",
    `${name}:latest`,
  ];

  // If cmd is provided, append it to override the default
  if (cmd && cmd.length > 0) {
    args.push(...cmd);
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
  // First arg is container name, rest are optional command args
  const [name, ...cmd] = Deno.args;
  if (!name) {
    console.error("Usage: run.ts <container-name> [cmd...]");
    Deno.exit(1);
  }

  await runTestContainer(name, cmd.length > 0 ? cmd : undefined);
} 