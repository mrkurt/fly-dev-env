import { parseArgs } from "@std/cli";
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";

// Configuration paths
const MIGRATIONS_DIR = "/data/system/migrations";
const METADATA_FILE = join(MIGRATIONS_DIR, "metadata.json");
const LOCK_DIR = "/data/system/lock";
const LOCK_FILE = join(LOCK_DIR, "migrate.lock");

interface Migration {
  timestamp: string;
  name: string;
  status: "pending" | "applied" | "failed";
  appliedAt?: string;
  failedAt?: string;
  error?: string;
}

interface MigrationMetadata {
  migrations: Migration[];
  lastApplied?: string;
}

interface MigrationContext {
  timestamp: string;
  label: string;
  migrationDir: string;
  metadata: MigrationMetadata;
}

// Load or initialize migration metadata
async function loadMigrationMetadata(): Promise<MigrationMetadata> {
  if (await exists(METADATA_FILE)) {
    const content = await Deno.readTextFile(METADATA_FILE);
    return JSON.parse(content);
  }
  return { migrations: [] };
}

// Save migration metadata
async function saveMigrationMetadata(metadata: MigrationMetadata): Promise<void> {
  await Deno.writeTextFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
}

async function setupMigrationContext(label: string): Promise<MigrationContext> {
  // Load existing metadata
  const metadata = await loadMigrationMetadata();

  // Check if this migration was already applied
  const existingMigration = metadata.migrations.find(m => m.name === label);
  if (existingMigration && existingMigration.status === "applied") {
    throw new Error(`Migration ${label} was already applied on ${existingMigration.appliedAt}`);
  }

  // Generate timestamp for new migration
  const now = new Date();
  const timestamp = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') + '-' +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');

  // Create migration directory with timestamp prefix
  const migrationDir = join(MIGRATIONS_DIR, `${timestamp}_${label}`);
  await ensureDir(migrationDir);

  // Add migration to metadata
  metadata.migrations.push({
    timestamp,
    name: label,
    status: "pending"
  });
  await saveMigrationMetadata(metadata);

  return { timestamp, label, migrationDir, metadata };
}

/**
 * Store the original command arguments and script contents
 */
async function storeMigrationDetails(ctx: MigrationContext, args: string[], flags: Record<string, unknown>): Promise<void> {
  // Store original command arguments
  const commandArgs = {
    args,
    flags
  };
  await Deno.writeTextFile(
    join(ctx.migrationDir, "command.json"),
    JSON.stringify(commandArgs, null, 2)
  );

  // Store script contents
  const scripts = {
    install: flags.install,
    run: flags.run,
    ready: flags.ready,
    rollback: flags.rollback
  };

  for (const [name, path] of Object.entries(scripts)) {
    if (path && typeof path === "string") {
      try {
        const content = await Deno.readTextFile(path);
        await Deno.writeTextFile(
          join(ctx.migrationDir, `${name}.sh`),
          content
        );
      } catch (error) {
        console.warn(`Warning: Failed to store ${name} script: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function executeScript(ctx: MigrationContext, scriptPath: string, phase: string): Promise<boolean> {
  // Run the script and capture its output
  const result = await new Deno.Command(scriptPath, {
    stdout: "piped",
    stderr: "piped",
  }).output();

  // Save the script output to the migration directory
  const output = new TextDecoder().decode(result.stdout) + "\n" + new TextDecoder().decode(result.stderr);
  await Deno.writeTextFile(
    join(ctx.migrationDir, `${phase}_output.log`),
    output
  );

  // If the script failed, update metadata
  if (!result.success) {
    const migration = ctx.metadata.migrations.find(m => m.name === ctx.label);
    if (migration) {
      migration.status = "failed";
      migration.failedAt = new Date().toISOString();
      migration.error = `${phase} phase failed: ${output}`;
      await saveMigrationMetadata(ctx.metadata);
    }
  }

  return result.success;
}

/**
 * Acquire a lock for migration
 * @throws Error if lock cannot be acquired
 */
async function acquireLock(): Promise<void> {
  await ensureDir(LOCK_DIR);

  try {
    // Try to create the lock file
    const lockFile = await Deno.open(LOCK_FILE, {
      write: true,
      create: true,
      createNew: true, // Fails if file exists
    });

    // Write PID and timestamp to lock file
    const pid = Deno.pid;
    const timestamp = new Date().toISOString();
    const lockInfo = `PID: ${pid}\nTimestamp: ${timestamp}\n`;
    await lockFile.write(new TextEncoder().encode(lockInfo));
    await lockFile.close();
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      // Check if lock is stale (read PID and check if process exists)
      try {
        const lockContent = await Deno.readTextFile(LOCK_FILE);
        const pidMatch = lockContent.match(/PID: (\d+)/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1]);
          try {
            // Check if process exists by trying to read /proc/<pid>/stat
            await Deno.stat(`/proc/${pid}/stat`);
            throw new Error("Another migration is currently running");
          } catch (e) {
            if (e instanceof Deno.errors.NotFound) {
              // Process doesn't exist, lock is stale
              console.log("Found stale lock, removing...");
              await Deno.remove(LOCK_FILE);
              // Retry acquiring lock
              return await acquireLock();
            }
            throw e;
          }
        }
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          // Lock file disappeared, retry
          return await acquireLock();
        }
        throw e;
      }
    }
    throw new Error(`Failed to acquire lock: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Release the migration lock
 */
async function releaseLock(): Promise<void> {
  try {
    await Deno.remove(LOCK_FILE);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn(`Warning: Failed to release lock: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function systemMigrate(args: string[]) {
  const flags = parseArgs(args, {
    string: ["name", "install", "run", "ready", "rollback"],
    default: {},
  });

  // Validate required arguments
  if (!flags.name) throw new Error("--name is required");
  if (!flags.install) throw new Error("--install script is required");
  if (!flags.run) throw new Error("--run script is required");
  if (flags.ready && !await Deno.stat(flags.ready).catch(() => false)) {
    throw new Error("Ready script not found");
  }
  if (flags.rollback && !await Deno.stat(flags.rollback).catch(() => false)) {
    throw new Error("Rollback script not found");
  }

  // Acquire lock before proceeding
  await acquireLock();

  try {
    // Run the migration
    const ctx = await setupMigrationContext(flags.name);

    // Store migration details
    await storeMigrationDetails(ctx, args, flags);

    try {
      // Install phase
      console.log(`Running install script for ${flags.name}...`);
      if (!await executeScript(ctx, flags.install, "install")) {
        throw new Error("Install script failed");
      }

      // Run phase
      console.log(`Running service script for ${flags.name}...`);
      if (!await executeScript(ctx, flags.run, "run")) {
        if (flags.rollback) {
          console.log("Run script failed, executing rollback...");
          await executeScript(ctx, flags.rollback, "rollback");
        }
        throw new Error("Run script failed");
      }

      // Ready check if provided
      if (flags.ready) {
        console.log(`Running ready check for ${flags.name}...`);
        if (!await executeScript(ctx, flags.ready, "ready")) {
          if (flags.rollback) {
            console.log("Ready check failed, executing rollback...");
            await executeScript(ctx, flags.rollback, "rollback");
          }
          throw new Error("Ready check failed");
        }
      }

      // Update metadata to mark migration as successful
      const migration = ctx.metadata.migrations.find(m => m.name === ctx.label);
      if (migration) {
        migration.status = "applied";
        migration.appliedAt = new Date().toISOString();
        ctx.metadata.lastApplied = migration.timestamp;
        await saveMigrationMetadata(ctx.metadata);
      }

      console.log(`Migration ${flags.name} completed successfully`);
    } catch (error: unknown) {
      // Ensure migration is marked as failed in metadata
      const migration = ctx.metadata.migrations.find(m => m.name === ctx.label);
      if (migration) {
        migration.status = "failed";
        migration.failedAt = new Date().toISOString();
        migration.error = error instanceof Error ? error.message : String(error);
        await saveMigrationMetadata(ctx.metadata);
      }
      throw error;
    }
  } finally {
    // Always release lock, even if migration fails
    await releaseLock();
  }
}
