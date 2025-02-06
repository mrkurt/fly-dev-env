/**
 * Helper for running commands in tests with output streaming and aggregation
 */

const decoder = new TextDecoder();

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  output: string; // Combined stdout + stderr
}

/**
 * Run a command and return its output, while also streaming to the console
 * @param cmd The command to run
 * @param args The arguments to pass to the command
 * @returns The command result with stdout, stderr and combined output
 */
export async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  // Print the command being run
  console.log("$", [cmd, ...args].join(" "));

  const command = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();
  
  // Create promises for stdout and stderr collection
  const result: CommandResult = {
    success: false,
    stdout: "",
    stderr: "",
    output: "",
  };

  // Collect stdout
  const stdoutPromise = (async () => {
    for await (const chunk of process.stdout) {
      const text = decoder.decode(chunk);
      result.stdout += text;
      result.output += text;
      await Deno.stdout.write(chunk);
    }
  })();

  // Collect stderr
  const stderrPromise = (async () => {
    for await (const chunk of process.stderr) {
      const text = decoder.decode(chunk);
      result.stderr += text;
      result.output += text;
      await Deno.stderr.write(chunk);
    }
  })();

  // Wait for process to complete AND output collection to finish
  const [{ success }] = await Promise.all([
    process.status,
    stdoutPromise,
    stderrPromise,
  ]);
  
  result.success = success;
  return result;
} 