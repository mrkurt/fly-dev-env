import { parse } from "@std/flags";
import { dirname, fromFileUrl } from "@std/path";
import { green, bold, red } from "@std/fmt/colors";
import { ImageType, IMAGES } from "./image-types.ts";

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

  const imagePath = IMAGES[imageType].path;
  console.log(green("==> ") + `Building ${bold(IMAGES[imageType].name)} image...`);

  // Generate tag with image type and timestamp
  const timestamp = Math.floor(Date.now() / 1000);
  const imageTag = `${imageType}-${timestamp}`;

  // Run the build command with both stdout and stderr piped
  const buildCmd = new Deno.Command("fly", {
    args: [
      "deploy", 
      imagePath, 
      "--remote-only", 
      "--build-only", 
      "--push", 
      "--app", 
      parsedArgs.app,
      "--image-label", 
      imageTag
    ],
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
    string: ["app", "type"],
    default: {
      type: "ubuntu-s6"
    }
  });

  if (!flags.app) {
    console.error(red("Error:") + " --app flag is required");
    console.log("\nAvailable image types:");
    for (const [type, config] of Object.entries(IMAGES)) {
      console.log(`  ${bold(type)}: ${config.description}`);
    }
    Deno.exit(1);
  }

  try {
    await buildImage(Deno.args);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(red("Error:"), error.message);
    } else {
      console.error(red("Unknown error:"), error);
    }
    Deno.exit(1);
  }
} 