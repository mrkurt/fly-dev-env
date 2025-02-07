// Main CLI entry point
// This will eventually handle command routing and argument parsing

import { parseArgs } from "@std/cli";
import { inspect } from "./commands/inspect.ts";

// Main entry point for the system-migrate CLI
export async function main(args: string[] = []): Promise<number> {
  const flags = parseArgs(args, {
    string: ["_"],
    boolean: ["help", "version"],
    default: { help: false, version: false },
  });

  if (flags.help) {
    console.log(`
system-migrate - System migration and state management tool

USAGE:
  system-migrate [command] [options]

COMMANDS:
  inspect     Inspect overlay and state mounts
  
OPTIONS:
  --help      Show this help message
  --version   Show version information
`);
    return 0;
  }

  if (flags.version) {
    console.log("system-migrate v0.1.0");
    return 0;
  }

  // Handle command and arguments
  const [command, ...commandArgs] = flags._ as string[];

  switch (command) {
    case "inspect":
      return await inspect(commandArgs);
    case undefined:
      console.error("Error: No command specified");
      return 1;
    default:
      console.error(`Error: Unknown command '${command}'`);
      return 1;
  }
}

// Run directly if called as script
if (import.meta.main) {
  Deno.exit(await main(Deno.args));
} 