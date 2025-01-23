// CRITICAL RULES FOR THIS FILE:
// 1. NEVER EVER use `fly machine update` or `flyctl machine update` - it does not work correctly
// 2. NEVER EVER use `fly image update` or `flyctl image update` - it breaks image builds
// 3. NEVER EVER use `fly deploy` or `flyctl deploy` - it will destroy the machine setup
// 4. ONLY use `fly deploy --build-only --push` for building images
// 5. ONLY use the machines API directly via fetch() for machine operations

// @deno-types="https://deno.land/std@0.219.0/flags/mod.ts"
import { parse } from "@std/flags";
import { buildImage } from "./build.ts";
import { dirname, fromFileUrl } from "@std/path";
import { delay } from "@std/async";
import { green, bold } from "@std/fmt/colors";

// Machine config template that should be used for all machines
const MACHINE_CONFIG = {
  env: {},
  init: {
    exec: null,
    entrypoint: null,
    cmd: null,
    tty: false
  },
  guest: {
    cpu_kind: "shared",
    cpus: 1,
    memory_mb: 256
  },
  metadata: {},
  restart: {
    policy: "on-failure",
    max_retries: 0
  },
  volumes: [
    {
      name: "data"
    }
  ],
  mounts: [
    {
      volume: "data",
      path: "/data"
    }
  ],
  containers: [
    {
      name: "dev",
      image: "", // Will be injected
      command: [],
      env: {}
    }
  ]
};

// API types
interface Machine {
  id: string;
  state: string;
  instance_id: string;
  private_ip: string;
  host_status: string;
  config?: MachineConfig;
  checks: Array<{
    name: string;
    status: string;
    output: string;
  }>;
  events: Array<{
    type: string;
    status: string;
    timestamp: number;
    request?: {
      exit_event?: {
        exit_code: number;
        oom_killed: boolean;
        requested_stop: boolean;
      };
    };
  }>;
}

interface MachineMount {
  encrypted?: boolean;
  path: string;
  size_gb?: number;
  volume: string;
  name?: string;
}

interface MachineConfig {
  env?: Record<string, string>;
  init?: Record<string, unknown>;
  guest?: {
    cpu_kind: string;
    cpus: number;
    memory_mb: number;
  };
  metadata?: Record<string, string>;
  restart?: {
    policy: string;
    max_retries: number;
  };
  volumes?: Array<{
    name: string;
  }>;
  mounts?: MachineMount[];
  containers?: Array<{
    name: string;
    image: string;
    command?: string[];
    env?: Record<string, string>;
  }>;
}

// Get a fresh auth token for the API
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

async function getMachines(appName: string): Promise<Machine[]> {
  const token = await getAuthToken();
  const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get machines: ${response.statusText}`);
  }

  return await response.json();
}

async function getVolumes(appName: string): Promise<Array<{id: string, name: string}>> {
  const token = await getAuthToken();
  const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/volumes`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get volumes: ${response.statusText}`);
  }

  return await response.json();
}

async function updateMachine(appName: string, machineId: string, config: MachineConfig): Promise<void> {
  const token = await getAuthToken();
  
  // Get existing machine config to get volume ID
  const machineResponse = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines/${machineId}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!machineResponse.ok) {
    throw new Error(`Failed to get machine config: ${machineResponse.statusText}`);
  }

  const machine = await machineResponse.json();
  const existingMounts = machine.config?.mounts as MachineMount[];
  
  if (!existingMounts?.length) {
    throw new Error("Could not find mounts in machine config");
  }

  // Preserve the existing mount configuration
  config.mounts = existingMounts;

  const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines/${machineId}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ 
      config,
      region: "atl", // Match volume region
      volume_attachments: existingMounts.map((mount: MachineMount) => ({
        volume: mount.volume
      }))
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update machine: ${response.status} ${response.statusText}\n${errorText}`);
  }
}

async function loadMachineConfig(): Promise<MachineConfig> {
  const cliDir = dirname(fromFileUrl(import.meta.url));
  const configPath = `${cliDir}/machine-config-template.json`;
  const configText = await Deno.readTextFile(configPath);
  return JSON.parse(configText);
}

async function waitForMachine(appName: string, machineId: string): Promise<void> {
  console.log(green("==> ") + "Waiting for machine to start...");
  
  for (let i = 0; i < 60; i++) { // Wait up to 60 seconds
    const token = await getAuthToken();
    const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines/${machineId}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get machine status: ${response.statusText}`);
    }

    const machine = await response.json();
    if (machine.state === "started") {
      return;
    }

    await delay(1000); // Wait 1 second between checks
  }

  throw new Error("Timed out waiting for machine to start");
}

async function destroyMachine(appName: string, machineId: string): Promise<void> {
  const token = await getAuthToken();
  const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines/${machineId}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to destroy machine: ${response.statusText}`);
  }
}

async function createMachine(appName: string, imageRef: string, volumeId: string): Promise<Machine> {
  const token = await getAuthToken();
  
  // Clone the template and inject the image
  const config = structuredClone(MACHINE_CONFIG);
  config.containers[0].image = imageRef;

  const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ 
      config,
      region: "atl", // Match volume region
      volume_attachments: [{
        volume: volumeId
      }]
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create machine: ${response.status} ${response.statusText}\n${errorText}`);
  }

  return await response.json();
}

// Main deploy function
export async function deploy(args: string[]) {
  const parsedArgs = parse(args, {
    string: ["app"],
    default: {}
  });

  if (!parsedArgs.app) {
    throw new Error("--app flag is required");
  }

  // Check if volume exists, create if not
  console.log(green("==> ") + "Checking for data volume...");
  const volumeCmd = new Deno.Command("fly", {
    args: ["volumes", "list", "--app", parsedArgs.app, "--json"],
    stdout: "piped"
  });
  const volumeResult = await volumeCmd.output();
  if (!volumeResult.success) {
    throw new Error("Failed to list volumes");
  }
  const volumes = JSON.parse(new TextDecoder().decode(volumeResult.stdout));
  let dataVolume = volumes.find((v: any) => v.name === "data");
  
  if (!dataVolume) {
    console.log(green("==> ") + "Creating 100GB data volume...");
    const createCmd = new Deno.Command("fly", {
      args: ["volumes", "create", "data", "--size", "100", "--app", parsedArgs.app, "-y", "--region", "atl", "--json"],
      stdout: "piped",
      stderr: "inherit"
    });
    const createResult = await createCmd.output();
    if (!createResult.success) {
      throw new Error("Failed to create volume");
    }
    // Parse volume ID from creation output
    const createOutput = new TextDecoder().decode(createResult.stdout);
    dataVolume = JSON.parse(createOutput);
  }

  // Build image first
  console.log(green("==> ") + "Building image...");
  const buildCmd = new Deno.Command("fly", {
    args: ["deploy", "--build-only", "--push", "--app", parsedArgs.app, parsedArgs._[0] as string],
    stdout: "piped",
    stderr: "piped"
  });
  const buildResult = await buildCmd.output();
  if (!buildResult.success) {
    throw new Error("Failed to build image");
  }

  // Parse the image tag from the build output
  const buildOutput = new TextDecoder().decode(buildResult.stdout) + new TextDecoder().decode(buildResult.stderr);
  // Print the output so we can see the build progress
  console.log(buildOutput);
  
  const imageMatch = buildOutput.match(/pushing manifest for (registry\.fly\.io\/[^:]+:deployment-[^\s@]+)/);
  if (!imageMatch) {
    throw new Error("Could not find image tag in build output");
  }
  const imageRef = imageMatch[1];

  // Get machine info
  console.log(green("==> ") + "Getting machine info...");
  const machines = await getMachines(parsedArgs.app);
  
  let machineId: string;
  if (!machines.length) {
    console.log(green("==> ") + "No machines found, creating new machine...");
    const machine = await createMachine(parsedArgs.app, imageRef, dataVolume.id);
    machineId = machine.id;
  } else {
    machineId = machines[0].id;
    // Update existing machine with new image
    console.log(green("==> ") + "Updating machine " + machineId + "...");
    const config = structuredClone(MACHINE_CONFIG);
    config.containers[0].image = imageRef;
    await updateMachine(parsedArgs.app, machineId, config);
  }

  // Wait for machine to start
  await waitForMachine(parsedArgs.app, machineId);

  console.log(green("✓ ") + "Deployment completed successfully");
}

// CLI entrypoint
if (import.meta.main) {
  try {
    await deploy(Deno.args);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    Deno.exit(1);
  }
} 