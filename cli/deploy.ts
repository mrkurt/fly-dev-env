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
import { green, bold, red } from "@std/fmt/colors";
import { ImageType, IMAGES } from "./image-types.ts";

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
  metadata: {
    "image-type": "" // Will be injected
  },
  restart: {
    policy: "on-failure",
    max_retries: 0
  },
  volumes: [
    {
      name: "" // Will be injected with image-type prefix
    }
  ],
  mounts: [
    {
      volume: "", // Will be injected with image-type prefix
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

async function getVolumes(appName: string): Promise<Array<{id: string, name: string, state: string}>> {
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
      region: "dfw", // Match volume region
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

// Find a machine by image type
async function findMachineByImageType(appName: string, imageType: string): Promise<Machine | undefined> {
  const machines = await getMachines(appName);
  return machines.find(m => m.config?.metadata?.["image-type"] === imageType);
}

// Find or create volume for image type
async function findOrCreateVolume(appName: string, imageType: string): Promise<string> {
  // Convert image type to valid volume name (replace hyphens with underscores)
  const volumeName = `data_${imageType.replace(/-/g, "_")}`;
  console.log(green("==> ") + "Looking for volume:", volumeName);
  
  const volumes = await getVolumes(appName);
  console.log(green("==> ") + "Existing volumes:", volumes);
  
  // Only consider active volumes (not in pending_destroy state)
  const volume = volumes.find(v => v.name === volumeName && v.state !== "pending_destroy");
  if (volume) {
    console.log(green("==> ") + "Found existing active volume:", volume.id);
    return volume.id;
  }

  // Create new volume if it doesn't exist or is being destroyed
  console.log(green("==> ") + "Creating new volume:", volumeName);
  const token = await getAuthToken();
  const volumeData = {
    name: volumeName,
    region: "dfw",
    size_gb: 50,
    encrypted: true,
    requires_unique_zone: false
  };

  const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/volumes`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(volumeData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Volume creation request:", JSON.stringify(volumeData, null, 2));
    console.error("Volume creation response:", errorText);
    throw new Error(`Failed to create volume: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const newVolume = await response.json();
  console.log(green("==> ") + "Created new volume:", newVolume.id);
  return newVolume.id;
}

// Create a new machine with the given image type
async function createMachine(appName: string, imageRef: string, imageType: string): Promise<string> {
  const token = await getAuthToken();
  const volumeId = await findOrCreateVolume(appName, imageType);
  
  // Create machine config from template
  const config = await loadMachineConfig();
  config.metadata = config.metadata || {};
  config.metadata["image-type"] = imageType;
  // Use same volume name format as in findOrCreateVolume
  const volumeName = `data_${imageType.replace(/-/g, "_")}`;
  if (config.volumes?.[0]) {
    config.volumes[0].name = volumeName;
  }
  if (config.mounts?.[0]) {
    config.mounts[0].volume = volumeName;
  }
  if (config.containers?.[0]) {
    config.containers[0].image = imageRef;
  }

  const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      config,
      region: "dfw",
      volume_attachments: [{
        volume: volumeId
      }]
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Machine creation request:", JSON.stringify({config, region: "dfw", volume_attachments: [{volume: volumeId}]}, null, 2));
    throw new Error(`Failed to create machine: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const machine = await response.json();
  return machine.id;
}

// Main deploy function
export async function deploy(args: string[]): Promise<void> {
  const parsedArgs = parse(args, {
    string: ["app", "type"],
    default: {
      type: "ubuntu-s6" // Default to ubuntu-s6 for backward compatibility
    }
  });

  if (!parsedArgs.app) {
    throw new Error("--app flag is required");
  }

  const imageType = parsedArgs.type as ImageType;
  if (!IMAGES[imageType]) {
    throw new Error(`Invalid image type: ${imageType}. Available types: ${Object.keys(IMAGES).join(", ")}`);
  }

  console.log(green("==> ") + `Deploying ${bold(IMAGES[imageType].name)}...`);

  // Build the image
  const imageRef = await buildImage(args);

  // Find existing machine of this type
  const existingMachine = await findMachineByImageType(parsedArgs.app, imageType);
  let machineId: string;

  if (existingMachine) {
    console.log(green("==> ") + "Updating existing machine...");
    // Update existing machine with template config
    const config = await loadMachineConfig();
    config.metadata = config.metadata || {};
    config.metadata["image-type"] = imageType;
    if (config.volumes?.[0]) {
      config.volumes[0].name = `data_${imageType.replace(/-/g, "_")}`;
    }
    if (config.mounts?.[0]) {
      config.mounts[0].volume = `data_${imageType.replace(/-/g, "_")}`;
    }
    if (config.containers?.[0]) {
      config.containers[0].image = imageRef;
    }
    
    await updateMachine(parsedArgs.app, existingMachine.id, config);
    machineId = existingMachine.id;
  } else {
    console.log(green("==> ") + "Creating new machine...");
    // Create new machine
    machineId = await createMachine(parsedArgs.app, imageRef, imageType);
  }

  // Wait for machine to start
  await waitForMachine(parsedArgs.app, machineId);
  console.log(green("✓ ") + "Deploy completed successfully");
}

async function getMachineConfig(appName: string, machineId: string): Promise<void> {
  const token = await getAuthToken();
  const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines/${machineId}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get machine config: ${response.statusText}`);
  }

  const machine = await response.json();
  console.log(JSON.stringify(machine, null, 2));
}

// CLI entrypoint
if (import.meta.main) {
  try {
    const args = parse(Deno.args, {
      string: ["app", "type", "machine"],
      default: {
        type: "ubuntu-s6" // Default to ubuntu-s6 for backward compatibility
      }
    });

    if (args.machine) {
      // Show machine config
      if (!args.app) {
        throw new Error("--app flag is required");
      }
      await getMachineConfig(args.app, args.machine);
    } else {
      // Regular deploy
      await deploy(Deno.args);
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    Deno.exit(1);
  }
} 