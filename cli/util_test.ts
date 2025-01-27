import { assertEquals } from "jsr:@std/assert";
import { buildCommandArray, execAsUser, execMachineCommand, type CommandSpec } from "./util.ts";

// Test helper function for command wrapping
function testCommandWrapping(command: string, expected: string, echoOnly = false) {
  const wrappedCmd = `sudo -u dev sh -c '${command.replace(/'/g, "'\\''")}'`;
  console.log("\nCommand:", command);
  console.log("Wrapped:", wrappedCmd);
  assertEquals(wrappedCmd, expected);

  // Verify the command structure is valid by echoing it
  const verifyCmd = new Deno.Command("bash", {
    args: ["-c", `echo ${wrappedCmd}`],
    stdout: "piped",
    stderr: "piped",
  });
  const output = verifyCmd.outputSync();
  if (!output.success) {
    throw new Error(`Command echo verification failed: ${new TextDecoder().decode(output.stderr)}`);
  }
  
  // Try executing the command structure (just the echo part if requested)
  const testCommand = echoOnly ? command.split(">")[0].trim() : command;
  const echoTest = new Deno.Command("bash", {
    args: ["-c", `echo ${testCommand}`],
    stdout: "piped",
    stderr: "piped",
  });
  const echoOutput = echoTest.outputSync();
  if (!echoOutput.success) {
    throw new Error(`Echo test failed: ${new TextDecoder().decode(echoOutput.stderr)}`);
  }
  console.log("Echo test output:", new TextDecoder().decode(echoOutput.stdout));
}

Deno.test("Basic command wrapping", () => {
  const command = "echo hello";
  const expected = "sudo -u dev sh -c 'echo hello'";
  testCommandWrapping(command, expected);
});

Deno.test("Command with single quotes", () => {
  const command = "echo 'hello world'";
  const expected = "sudo -u dev sh -c 'echo '\\''hello world'\\'''";
  testCommandWrapping(command, expected);
});

Deno.test("Command with double quotes", () => {
  const command = 'echo "hello world"';
  const expected = "sudo -u dev sh -c 'echo \"hello world\"'";
  testCommandWrapping(command, expected);
});

Deno.test("Command with both quote types", () => {
  const command = 'echo "hello \'world\'"';
  const expected = "sudo -u dev sh -c 'echo \"hello '\\''world'\\''\"'";
  testCommandWrapping(command, expected);
});

Deno.test("Command with shell metacharacters", () => {
  const command = 'echo hello && echo world';
  const expected = "sudo -u dev sh -c 'echo hello && echo world'";
  testCommandWrapping(command, expected);
});

Deno.test("SSH key command", () => {
  const command = "echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKNB7OALYg3PuR8/LFZY92MgULxfqvQgom3aDZ4B9WSz test@example.com' > /home/dev/.ssh/authorized_keys";
  const expected = "sudo -u dev sh -c 'echo '\\''ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKNB7OALYg3PuR8/LFZY92MgULxfqvQgom3aDZ4B9WSz test@example.com'\\'' > /home/dev/.ssh/authorized_keys'";
  testCommandWrapping(command, expected, true); // Only test the echo part
});

// Integration tests that require a running machine
// These will be skipped unless FLY_TEST_APP and FLY_TEST_MACHINE env vars are set
Deno.test({
  name: "API command execution",
  ignore: !Deno.env.get("FLY_TEST_APP") || !Deno.env.get("FLY_TEST_MACHINE"),
  fn: async () => {
    const app = Deno.env.get("FLY_TEST_APP")!;
    const machine = Deno.env.get("FLY_TEST_MACHINE")!;

    // Test raw command execution
    const result = await execMachineCommand(app, machine, "echo hello", { debug: true });
    assertEquals(result.stdout.trim(), "hello");
    assertEquals(result.exitCode, 0);

    // Test execAsUser wrapper
    const userResult = await execAsUser(app, machine, "whoami", { debug: true });
    assertEquals(userResult.trim(), "dev");
  }
}); 