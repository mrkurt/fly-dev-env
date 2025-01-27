// SSH key installation and management
// NEVER pass command args as multiple array entries when using fly machines exec,
// always put full commands in one string, e.g.:
// GOOD: ["sh -c \"mkdir -p /home/dev/.ssh && chmod 700 /home/dev/.ssh\""]
// BAD:  ["sh", "-c", "mkdir -p /home/dev/.ssh && chmod 700 /home/dev/.ssh"]

import { parse } from "@std/flags";
import { green } from "@std/fmt/colors";
import { execAsUser } from "./util.ts";

interface InstallArgs {
  app: string;
  machine?: string;
  help?: boolean;
  remove?: string;
  key?: string;
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

export async function installKey(args: string[]) {
  const parsedArgs = parse(args, {
    string: ["app", "machine", "remove", "key"],
    boolean: ["help"],
    alias: { h: "help" },
    default: {},
  }) as InstallArgs;

  if (parsedArgs.help) {
    console.log("Usage: ssh-key --app <app-name> [--machine <machine-id>] [--key <key-file>] [--remove <name@host>]");
    return;
  }

  if (!parsedArgs.app) {
    throw new Error("--app flag is required");
  }

  // Get machine ID if not specified
  const machineId = parsedArgs.machine || await getMachineId(parsedArgs.app);

  // Handle remove if specified
  if (parsedArgs.remove) {
    console.log(green("==> ") + `Removing key for ${parsedArgs.remove}...`);
    await execAsUser(parsedArgs.app, machineId, `sed -i '/${parsedArgs.remove}/d' /home/dev/.ssh/authorized_keys`);
    console.log(green("✓ ") + "Key removed successfully");
    return;
  }

  // Determine which key file to use
  let keyPath: string;
  if (parsedArgs.key) {
    keyPath = parsedArgs.key;
  } else {
    keyPath = Deno.env.get("HOME") + "/.ssh/id_rsa.pub";
  }

  // Check if key file exists
  try {
    await Deno.stat(keyPath);
  } catch {
    throw new Error(`SSH key not found at ${keyPath}`);
  }

  // Read the public key
  const pubKey = await Deno.readTextFile(keyPath);
  console.log(green("==> ") + "Installing public key...");

  // Create .ssh directory and set permissions if needed
  await execAsUser(parsedArgs.app, machineId, 'mkdir -p /home/dev/.ssh && chmod 700 /home/dev/.ssh');

  // Install the public key directly - our command escaping handles the quoting
  await execAsUser(parsedArgs.app, machineId, 
    `echo '${pubKey.trim()}' > /home/dev/.ssh/authorized_keys && chmod 600 /home/dev/.ssh/authorized_keys`
  );

  // Verify the key was installed correctly
  const output = await execAsUser(parsedArgs.app, machineId, 'cat /home/dev/.ssh/authorized_keys');
  console.log(green("==> ") + "Installed key contents:");
  console.log(output);

  // Double check the key is there and readable
  await execAsUser(parsedArgs.app, machineId,
    `grep -q '${pubKey.trim()}' /home/dev/.ssh/authorized_keys || (echo "Key not found in authorized_keys" >&2 && exit 1)`
  );

  console.log(green("✓ ") + "SSH key installed and verified successfully");
}

// CLI entrypoint
if (import.meta.main) {
  try {
    await installKey(Deno.args);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    Deno.exit(1);
  }
} 