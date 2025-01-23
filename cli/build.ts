import { parse } from "@std/flags";
import { dirname, fromFileUrl } from "@std/path";
import { green, bold } from "@std/fmt/colors";

// Get a fresh auth token for the build
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

// Build and return image reference
export async function buildImage(args: string[]): Promise<string> {
  const parsedArgs = parse(args, {
    string: ["app", "path"],
    default: {}
  });

  if (!parsedArgs.app) {
    throw new Error("--app flag is required");
  }

  // First non-flag argument is the directory
  const directory = parsedArgs._.length > 0 ? String(parsedArgs._[0]) : ".";

  console.log(green("==> ") + "Building image...");

  // Run the build command with both stdout and stderr piped
  const buildCmd = new Deno.Command("fly", {
    args: ["deploy", directory, "--remote-only", "--build-only", "--push", "--app", parsedArgs.app],
    stdout: "piped",
    stderr: "piped"
  });

  const buildResult = await buildCmd.output();
  if (!buildResult.success) {
    console.error(new TextDecoder().decode(buildResult.stderr));
    throw new Error("Build failed");
  }

  // Print the build output
  const stderr = new TextDecoder().decode(buildResult.stderr);
  console.log(stderr);

  // Parse the output to get the image reference
  const lines = stderr.split("\n");
  const imageLine = lines.find(line => line.trim().startsWith("image:"));
  if (!imageLine) {
    throw new Error("Could not find image reference in build output");
  }

  const imageRef = imageLine.trim().replace("image: ", "");
  console.log(green("✓ ") + "Build completed successfully");
  return imageRef;
}

// CLI entrypoint
if (import.meta.main) {
  const flags = parse(Deno.args, {
    string: ["app", "path"],
  });

  if (!flags.app) {
    console.error("Error: --app flag is required");
    Deno.exit(1);
  }

  try {
    await buildImage(Deno.args);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    Deno.exit(1);
  }
} 