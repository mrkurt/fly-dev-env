import { runCommand } from "../tests/helpers/cmd.ts";

// Configuration
const NEW_ROOT = "/mnt/newroot";
const UPPER_DIR = "/data/upper";
const WORK_DIR = "/data/work";

// Save shell environment
const shell = Deno.env.get("SHELL") || "/bin/sh";
const home = Deno.env.get("HOME") || "/root";

// Create required directories
// ... existing code ...

// Change to root directory before mounting essential directories
await runCommand("cd", ["/"]);

// Mount essential system directories
// ... existing code ...

// Mount tmp before switching root
await runCommand("mount", ["--bind", "/tmp", `${NEW_ROOT}/tmp`]);

// Switch root
await runCommand("cd", [NEW_ROOT]);
await runCommand("pivot_root", [".", "oldroot"]);

console.log("Successfully switched to overlay root filesystem");

// Hide old root from systemd by mounting tmpfs over it
// First unmount the overlay lazily to avoid "device busy" errors
const umountResult = await runCommand("umount", ["-l", "/oldroot"]);
if (!umountResult.success) {
  console.warn("Warning: Failed to unmount /oldroot");
}

// Debug - show mount status after unmount
const findmnt1Result = await runCommand("findmnt", ["/oldroot"]);
console.log("Debug - /oldroot mount after unmount:", findmnt1Result.stdout);

// Mount tmpfs over oldroot to hide it from systemd
const mountResult = await runCommand("mount", ["-t", "tmpfs", "tmpfs", "/oldroot"]);
if (!mountResult.success) {
  console.warn("Warning: Failed to mount tmpfs over /oldroot");
}

// Debug - show mount status after tmpfs
const findmnt2Result = await runCommand("findmnt", ["/oldroot"]);
console.log("Debug - /oldroot mount after tmpfs:", findmnt2Result.stdout);

// Restore shell environment
Deno.env.set("SHELL", shell);
Deno.env.set("HOME", home);

// Hand off to init
// ... existing code ...
