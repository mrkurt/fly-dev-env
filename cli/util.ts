// Utility functions for interacting with Fly.io machines API

/**
 * Get the Fly.io auth token for API requests.
 * Uses fly auth token command.
 */
async function getAuthToken(): Promise<string> {
  const tokenCmd = new Deno.Command("fly", {
    args: ["auth", "token"],
    stdout: "piped",
    stderr: "piped",
  });
  const tokenResult = await tokenCmd.output();
  if (!tokenResult.success) {
    throw new Error("Failed to get auth token");
  }
  return new TextDecoder().decode(tokenResult.stdout).trim();
}

/**
 * Represents a command to be executed
 */
export interface CommandSpec {
  /** The command to execute */
  command: string;
  /** Array of arguments */
  args?: string[];
}

/**
 * Options for command execution
 */
export interface ExecOptions {
  /** Enable debug output */
  debug?: boolean;
  /** Throw error on non-zero exit code */
  failOnError?: boolean;
}

/**
 * Build a command array from a CommandSpec
 */
export function buildCommandArray(spec: CommandSpec): string[] {
  const args = spec.args || [];
  return [spec.command, ...args];
}

/**
 * Execute a command on a Fly.io machine using the machines API exec endpoint.
 * 
 * IMPORTANT RULES FOR COMMAND EXECUTION:
 * 1. Use command array field with args as separate items
 * 2. The API will execute the command
 * 
 * @param app The Fly.io app name
 * @param machineId The ID of the machine to execute on
 * @param command The command to execute (as a single string)
 * @param options Optional settings for command execution
 */
export async function execMachineCommand(
  app: string,
  machineId: string,
  command: string,
  options: {
    debug?: boolean;
    failOnError?: boolean;
  } = {}
): Promise<{stdout: string; stderr: string; exitCode: number}> {
  const token = await getAuthToken();
  
  // Split into array without spaces between items
  const commandArray = command.split(" ");
  const requestBody = { command: commandArray };
  
  if (options.debug) {
    console.log("Raw command:", command);
    console.log("Command array:", JSON.stringify(commandArray));
    console.log("Request body:", JSON.stringify(requestBody));
    console.log("API URL:", `https://api.machines.dev/v1/apps/${app}/machines/${machineId}/exec`);
    console.log("API Request:", {
      method: "POST",
      headers: {
        "Authorization": "Bearer <token>",
        "Content-Type": "application/json",
      },
      body: requestBody  // Show the raw object before stringification
    });
  }
  
  const response = await fetch(`https://api.machines.dev/v1/apps/${app}/machines/${machineId}/exec`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),  // Only stringify once
  });

  const result = await response.json();
  
  if (options.debug) {
    console.log("Response:", JSON.stringify(result, null, 2));
    if (!response.ok) {
      console.log("HTTP Status:", response.status);
      console.log("HTTP Status Text:", response.statusText);
      console.log("Full Response:", result);
    }
  }

  if (!response.ok) {
    throw new Error(`Command failed: ${JSON.stringify(result, null, 2)}`);
  }

  const output = {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.exit_code || 0
  };

  if (options.failOnError && output.exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${output.exitCode}\n` +
      `stderr: ${output.stderr}\n` +
      `stdout: ${output.stdout}`
    );
  }

  return output;
}

/**
 * Helper to run a command as the dev user.
 * Automatically wraps the command in sudo -u dev and handles argument passing.
 */
export async function execAsUser(app: string, machineId: string, cmd: string, options: ExecOptions = { debug: true, failOnError: true }): Promise<string> {
  // Wrap the command in sh -c to handle shell features, but avoid extra quoting
  const wrappedCmd = `sudo -u dev sh -c '${cmd.replace(/'/g, "'\\''")}'`;

  if (options.debug) {
    console.log("\nCommand:", cmd);
    console.log("Wrapped:", wrappedCmd);
  }

  const result = await execMachineCommand(app, machineId, wrappedCmd, options);
  return result.stdout;
} 