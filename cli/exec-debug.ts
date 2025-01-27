// Debug tool for testing machine command execution
// Helps diagnose issues with command escaping and execution
//
// NOTE: If commands fail with "unknown: failed to run command: EOF",
// this usually indicates the machine is in a bad state and needs
// to be restarted. This is not a problem with the command format.

import { parse } from "@std/flags";
import { green } from "@std/fmt/colors";
import { execAsUser, execMachineCommand } from "./util.ts";

interface DebugArgs {
  app: string;
  machine?: string;
  help?: boolean;
  raw?: boolean;  // If true, skip execAsUser wrapper
  _: string[];    // Remaining arguments (the command)
}

async function getMachineId(app: string): Promise<string> {
  const machineCmd = new Deno.Command("fly", {
    args: ["machines", "list", "--app", app, "--json"],
    stdout: "piped",
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

export async function execDebug(args: string[]) {
  const parsedArgs = parse(args, {
    string: ["app", "machine"],
    boolean: ["help", "raw"],
    alias: { h: "help" },
    default: { raw: false },
  }) as DebugArgs;

  if (parsedArgs.help) {
    console.log(`Usage: exec-debug --app <app-name> [--machine <machine-id>] [--raw] [command...]
    
Options:
  --app      Application name (required)
  --machine  Machine ID (optional, uses first available if not specified)
  --raw      Skip execAsUser wrapper and execute command directly
  --help     Show this help message

Examples:
  exec-debug --app myapp "echo hello"
  exec-debug --app myapp --raw "whoami"
  exec-debug --app myapp --machine abc123 "ls -la /home/dev"
`);
    return;
  }

  if (!parsedArgs.app) {
    throw new Error("--app flag is required");
  }

  // Get the command from remaining args
  const command = parsedArgs._.join(" ");
  if (!command) {
    throw new Error("Command is required");
  }

  // Get machine ID if not specified
  const machineId = parsedArgs.machine || await getMachineId(parsedArgs.app);

  console.log(green("==> ") + "Executing command on machine " + machineId + ":");
  console.log(command);
  console.log();

  try {
    if (parsedArgs.raw) {
      // Execute command directly
      const result = await execMachineCommand(parsedArgs.app, machineId, command, { debug: true });
      console.log("\nResult:");
      console.log("stdout:", result.stdout || "(empty)");
      console.log("stderr:", result.stderr || "(empty)");
      console.log("exit code:", result.exitCode);
    } else {
      // Execute command via execAsUser
      const output = await execAsUser(parsedArgs.app, machineId, command, { debug: true });
      console.log("\nOutput:", output || "(empty)");
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("\nError:", error.message);
    } else {
      console.error("\nError:", String(error));
    }
    Deno.exit(1);
  }
}

// CLI entrypoint
if (import.meta.main) {
  try {
    await execDebug(Deno.args);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    Deno.exit(1);
  }
} 