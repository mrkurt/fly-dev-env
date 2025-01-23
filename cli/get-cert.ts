// We decided to use flyctl machine exec directly because:
// 1. It handles machine selection and auth properly 
// 2. It has better error handling and output formatting
// 3. Reduces code duplication and maintenance
// 4. Matches how the official CLI works

import { parse } from "@std/flags";
import { green } from "@std/fmt/colors";

async function getMachineId(app: string, specifiedMachine?: string): Promise<string> {
  if (specifiedMachine) return specifiedMachine;

  console.log(green("==> ") + "No machine specified, getting first available machine...");
  const machineCmd = new Deno.Command("fly", {
    args: ["machines", "list", "--app", app, "--json"],
    stdout: "piped"
  });
  const machineResult = await machineCmd.output();
  if (!machineResult.success) {
    throw new Error("Failed to get machine information");
  }
  const machines = JSON.parse(new TextDecoder().decode(machineResult.stdout));
  if (!machines.length) {
    throw new Error("No machines found");
  }
  return machines[0].id;
}

export async function getCert(args: string[]) {
  const parsedArgs = parse(args, {
    string: ["app", "machine"],
    default: {}
  });

  if (!parsedArgs.app) {
    throw new Error("--app flag is required");
  }

  const machineId = await getMachineId(parsedArgs.app, parsedArgs.machine);
  console.log(green("==> ") + "Generating SSH certificate...");
  
  // Use flyctl machine exec to run generate-cert command
  // We use --json for structured output and bash -c to run the command
  const certCmd = new Deno.Command("fly", {
    args: [
      "machine", "exec",
      "--json",
      "-a", parsedArgs.app,
      machineId,
      "bash -c '/usr/local/bin/generate-cert'"
    ],
    stdout: "piped",
    stderr: "piped"
  });

  const certResult = await certCmd.output();
  if (!certResult.success) {
    throw new Error("Failed to generate certificate: " + new TextDecoder().decode(certResult.stderr));
  }

  // Parse JSON output to get stdout
  const result = JSON.parse(new TextDecoder().decode(certResult.stdout));
  console.log(result.stdout);
}

// CLI entrypoint
if (import.meta.main) {
  try {
    await getCert(Deno.args);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    Deno.exit(1);
  }
} 