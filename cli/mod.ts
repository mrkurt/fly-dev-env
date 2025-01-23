import { parse } from "@std/flags";
import { buildImage } from "./build.ts";
import { deploy } from "./deploy.ts";
import { ssh } from "./ssh.ts";
import { installKey } from "./ssh-key.ts";
import { getCert } from "./get-cert.ts";
import * as colors from "@std/fmt/colors";

const { green, bold } = colors;

const args = parse(Deno.args, {
  string: ["app"],
  boolean: ["help"],
  default: { help: false }
});

if (args.help || args._.length === 0) {
  console.log(`Usage: machines <command> [options]

Commands:
  build     Build a new image
  deploy    Deploy a new image and update machines
  ssh       Connect to a machine via SSH
  ssh-key   Install SSH keys on a machine
  get-cert  Test getting SSH certificate from a machine

Options:
  --app     Application name (required)
  --help    Show this help message`);
  Deno.exit(0);
}

const command = args._[0];
const commandArgs = Deno.args.slice(1);

if (!args.app) {
  console.error("Error: --app flag is required");
  Deno.exit(1);
}

const commands = {
  build: buildImage,
  deploy,
  "get-cert": getCert,
  ssh,
} as const;

try {
  switch (command) {
    case "build":
      await buildImage(commandArgs);
      break;
    case "deploy":
      await deploy(commandArgs);
      break;
    case "ssh":
      await ssh(commandArgs);
      break;
    case "ssh-key":
      await installKey(commandArgs);
      break;
    case "get-cert":
      await getCert(commandArgs);
      break;
    default:
      console.error(`Error: Unknown command '${command}'`);
      Deno.exit(1);
  }
} catch (error: unknown) {
  if (error instanceof Error) {
    console.error("Error:", error.message);
  } else {
    console.error("Unknown error:", error);
  }
  Deno.exit(1);
} 