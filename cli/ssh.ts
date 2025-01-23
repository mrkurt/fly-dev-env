import { parse } from "@std/flags";
import { green } from "@std/fmt/colors";

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

export async function ssh(args: string[]) {
  const parsedArgs = parse(args, {
    string: ["app"],
    boolean: ["help"],
    alias: { h: "help" },
    default: {},
  });

  if (parsedArgs.help) {
    console.log("Usage: ssh --app <app-name>");
    return;
  }

  if (!parsedArgs.app) {
    throw new Error("--app flag is required");
  }

  // Get machine ID and start proxy
  console.log(green("==> ") + "No machine specified, getting first available machine...");
  const machineId = await getMachineId(parsedArgs.app);

  // Start fly proxy in the background
  const proxyPort = 2222;
  console.log(green("==> ") + "Starting proxy on port " + proxyPort + "...");
  const proxyCmd = new Deno.Command("fly", {
    args: ["proxy", `${proxyPort}:22`, "--app", parsedArgs.app],
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  });

  const proxyChild = proxyCmd.spawn();

  // Give proxy a moment to start
  console.log(green("==> ") + "Waiting for proxy to start...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Connect via SSH
  console.log(green("==> ") + "Connecting via SSH...");
  const sshCmd = new Deno.Command("ssh", {
    args: [
      "-p", proxyPort.toString(),
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "dev@localhost",
    ],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    const sshChild = await sshCmd.output();
    
    // Check SSH exit code
    if (sshChild.code !== 0) {
      throw new Error("SSH connection failed");
    }
  } finally {
    // Clean up proxy process
    proxyChild.kill("SIGTERM");
  }
}

// CLI entrypoint
if (import.meta.main) {
  try {
    await ssh(Deno.args);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    Deno.exit(1);
  }
} 