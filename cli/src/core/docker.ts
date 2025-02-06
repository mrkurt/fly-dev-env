// Docker interaction utilities for testing

/**
 * Options for running a Docker container
 */
export interface ContainerOptions {
  /** Whether to run in privileged mode */
  privileged?: boolean;
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  workdir?: string;
}

/**
 * Result of a Docker command execution
 */
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Represents a running Docker container
 */
export class Container {
  private id: string;

  constructor(id: string) {
    this.id = id;
  }

  /**
   * Execute a command in the container
   */
  async exec(command: string[]): Promise<CommandResult> {
    const cmd = new Deno.Command("docker", {
      args: ["exec", this.id, ...command],
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stdout, stderr } = await cmd.output();
    return {
      success,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
      code: success ? 0 : 1,
    };
  }

  /**
   * Stop and remove the container
   */
  async cleanup(): Promise<void> {
    const stop = new Deno.Command("docker", {
      args: ["stop", this.id],
      stdout: "piped",
      stderr: "piped",
    });
    await stop.output();

    const rm = new Deno.Command("docker", {
      args: ["rm", this.id],
      stdout: "piped",
      stderr: "piped",
    });
    await rm.output();
  }
}

/**
 * Build a Docker image from a Dockerfile
 */
export async function buildImage(
  dockerfilePath: string,
  tag: string,
): Promise<void> {
  const cmd = new Deno.Command("docker", {
    args: ["build", "-f", dockerfilePath, "-t", tag, "."],
    stdout: "piped",
    stderr: "piped",
  });

  const { success, stderr } = await cmd.output();
  if (!success) {
    throw new Error(
      `Failed to build image: ${new TextDecoder().decode(stderr)}`,
    );
  }
}

/**
 * Start a new Docker container
 */
export async function startContainer(
  image: string,
  options: ContainerOptions = {},
): Promise<Container> {
  const args = ["run", "-d"];
  
  if (options.privileged) {
    args.push("--privileged");
  }

  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  if (options.workdir) {
    args.push("-w", options.workdir);
  }

  args.push(image);

  const cmd = new Deno.Command("docker", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { success, stdout, stderr } = await cmd.output();
  if (!success) {
    throw new Error(
      `Failed to start container: ${new TextDecoder().decode(stderr)}`,
    );
  }

  const containerId = new TextDecoder().decode(stdout).trim();
  return new Container(containerId);
} 