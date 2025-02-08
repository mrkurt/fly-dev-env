import { runCommand } from "./helpers/cmd.ts";

async function runTests() {
  // Run overlayfs_setup_test.ts first
  const overlayfsSetupResult = await runCommand("deno", ["test", "tests/overlayfs_setup_test.ts"]);
  if (!overlayfsSetupResult.success) {
    console.error("overlayfs_setup_test.ts failed. Aborting further tests.");
    Deno.exit(1);
  }

  // Run all other tests
  const allTestsResult = await runCommand("deno", ["test"]);
  if (!allTestsResult.success) {
    console.error("Some tests failed.");
    Deno.exit(1);
  }

  console.log("All tests passed successfully.");
}

await runTests();