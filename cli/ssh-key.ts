import { parse } from "@std/flags";
import { green, bold } from "@std/fmt/colors";

interface InstallArgs {
  app: string;
  machine: string;
  generate?: boolean;
}

async function getAuthToken(): Promise<string> {
  const tokenProcess = new Deno.Command("flyctl", {
    args: ["auth", "token"],
    stdout: "piped",
    stderr: "piped",
  });

  const output = await tokenProcess.output();
  if (!output.success) {
    throw new Error("Failed to get auth token");
  }

  return new TextDecoder().decode(output.stdout).trim();
}

export async function installKey(args: string[]) {
  const parsedArgs = parse(args, {
    string: ["app", "machine"],
    boolean: ["generate"],
    default: { generate: false }
  }) as InstallArgs;

  if (!parsedArgs.app) {
    throw new Error("--app flag is required");
  }
  if (!parsedArgs.machine) {
    throw new Error("--machine flag is required");
  }

  let pubKey: string;

  if (parsedArgs.generate) {
    console.log(green("==> ") + "Generating new ED25519 key pair...");
    
    // Generate key pair and capture output directly
    const keygenCmd = new Deno.Command("ssh-keygen", {
      args: [
        "-t", "ed25519",
        "-C", `fly-dev-env-${parsedArgs.machine}`,
        "-f", "/dev/stdout",
        "-N", ""
      ],
      stdout: "piped",
      stderr: "piped"
    });
    
    const keygenResult = await keygenCmd.output();
    if (!keygenResult.success) {
      throw new Error("Failed to generate SSH key pair");
    }

    // Parse the output to get private and public keys
    const output = new TextDecoder().decode(keygenResult.stdout);
    const [privKey, pubKeyOutput] = output.split("\n").filter(line => line.trim().length > 0);
    pubKey = pubKeyOutput;

    console.log(green("✓ ") + "Generated new ED25519 key pair");
    console.log("\nPrivate key (save this somewhere safe):\n");
    console.log(privKey);
    console.log("\nPublic key:\n");
    console.log(pubKey);
  } else {
    // Read existing public key
    pubKey = await Deno.readTextFile(Deno.env.get("HOME") + "/.ssh/id_ed25519.pub");
  }

  console.log(green("==> ") + "Installing public key...");

  const token = await getAuthToken();

  // Create .ssh directory and set permissions
  const mkdirResponse = await fetch(`https://api.machines.dev/v1/apps/${parsedArgs.app}/machines/${parsedArgs.machine}/exec`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      cmd: "mkdir -p /home/dev/.ssh && chmod 700 /home/dev/.ssh"
    })
  });

  if (!mkdirResponse.ok) {
    throw new Error("Failed to create .ssh directory: " + await mkdirResponse.text());
  }

  // Install the public key
  const installResponse = await fetch(`https://api.machines.dev/v1/apps/${parsedArgs.app}/machines/${parsedArgs.machine}/exec`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      cmd: `echo '${pubKey}' > /home/dev/.ssh/authorized_keys && chmod 600 /home/dev/.ssh/authorized_keys && cat /home/dev/.ssh/authorized_keys`
    })
  });

  if (!installResponse.ok) {
    throw new Error("Failed to install public key: " + await installResponse.text());
  }

  const responseText = await installResponse.text();
  console.log(green("==> ") + "Installed key contents:");
  console.log(responseText);

  console.log(green("✓ ") + "SSH key installed successfully");
} 