import { assertEquals } from "@std/assert";
import { systemMigrate } from "../commands/system-migrate.ts";
import { join } from "@std/path";
import { exists } from "@std/fs";

Deno.test("postgres migration", async (t) => {
  // Create install script
  const installScript = "/tmp/postgres-install.sh";
  const installContent = `#!/bin/sh
set -e

# Create postgres group if it doesn't exist
if ! getent group postgres > /dev/null; then
    echo "Creating postgres group..."
    groupadd -r postgres
fi

# Create postgres user if it doesn't exist
if ! getent passwd postgres > /dev/null; then
    echo "Creating postgres user..."
    useradd -r -g postgres -d /var/lib/pgsql -s /bin/bash postgres
fi

# Install PostgreSQL packages
dnf install -y postgresql-server postgresql

# Create required directories with proper ownership
mkdir -p /var/lib/pgsql
mkdir -p /var/run/postgresql
mkdir -p /var/log/postgresql

# Set proper ownership
chown -R postgres:postgres /var/lib/pgsql
chown -R postgres:postgres /var/run/postgresql
chown -R postgres:postgres /var/log/postgresql

# Set proper permissions
chmod 755 /var/lib/pgsql
chmod 2775 /var/run/postgresql
chmod 755 /var/log/postgresql
`;
  await Deno.writeTextFile(installScript, installContent);
  await Deno.chmod(installScript, 0o755);

  // Create run script
  const runScript = "/tmp/postgres-run.sh";
  const runContent = `#!/bin/sh
set -e

# Set up s6 service
mkdir -p /etc/s6-overlay/s6-rc.d/postgres
echo "longrun" > /etc/s6-overlay/s6-rc.d/postgres/type

# Create run script
cat > /etc/s6-overlay/s6-rc.d/postgres/run << 'EOF'
#!/command/with-contenv sh
exec s6-setuidgid postgres /usr/bin/postgres
EOF
chmod +x /etc/s6-overlay/s6-rc.d/postgres/run

# Create up script
cat > /etc/s6-overlay/s6-rc.d/postgres/up << 'EOF'
#!/command/with-contenv sh
exec s6-setuidgid postgres /usr/bin/initdb -D /var/lib/pgsql/data
EOF
chmod +x /etc/s6-overlay/s6-rc.d/postgres/up

# Enable service
mkdir -p /etc/s6-overlay/s6-rc.d/user/contents.d
touch /etc/s6-overlay/s6-rc.d/user/contents.d/postgres
`;
  await Deno.writeTextFile(runScript, runContent);
  await Deno.chmod(runScript, 0o755);

  // Create ready check script
  const readyScript = "/tmp/postgres-ready.sh";
  const readyContent = `#!/bin/sh
set -e

# Verify service is set up correctly
test -d "/etc/s6-overlay/s6-rc.d/postgres"
test -f "/etc/s6-overlay/s6-rc.d/postgres/type"
test -x "/etc/s6-overlay/s6-rc.d/postgres/run"
test -x "/etc/s6-overlay/s6-rc.d/postgres/up"
test -f "/etc/s6-overlay/s6-rc.d/user/contents.d/postgres"

# Verify directories exist with correct ownership
test -d "/var/lib/pgsql" && test "$(stat -c %U:%G /var/lib/pgsql)" = "postgres:postgres"
test -d "/var/run/postgresql" && test "$(stat -c %U:%G /var/run/postgresql)" = "postgres:postgres"
test -d "/var/log/postgresql" && test "$(stat -c %U:%G /var/log/postgresql)" = "postgres:postgres"
`;
  await Deno.writeTextFile(readyScript, readyContent);
  await Deno.chmod(readyScript, 0o755);

  await t.step("verify migration process", async () => {
    // Run migration
    await systemMigrate([
      "--name", "postgres",
      "--install", installScript,
      "--run", runScript,
      "--ready", readyScript
    ]);

    // Find the migration directory
    const migrations = await Deno.readDir("/data/system/migrations");
    let migrationDir = "";
    for await (const entry of migrations) {
      if (entry.name.endsWith("_postgres")) {
        migrationDir = join("/data/system/migrations", entry.name);
        break;
      }
    }
    assertEquals(migrationDir !== "", true, "Migration directory should exist");

    // Verify script outputs were captured for each phase
    const phases = ["install", "run", "ready"];
    for (const phase of phases) {
      const outputLog = join(migrationDir, `${phase}_output.log`);
      assertEquals(await exists(outputLog), true, `${phase} output log should exist`);

      // Read and verify script output
      const logContent = await Deno.readTextFile(outputLog);
      console.log(`\n${phase} Phase Output:`);
      console.log("==================");
      console.log(logContent);
      console.log("==================\n");
    }

    // Verify key paths exist
    const paths = [
      "/var/lib/pgsql",
      "/var/run/postgresql",
      "/var/log/postgresql",
      "/etc/s6-overlay/s6-rc.d/postgres",
      "/etc/s6-overlay/s6-rc.d/postgres/run",
      "/etc/s6-overlay/s6-rc.d/postgres/up",
      "/etc/s6-overlay/s6-rc.d/user/contents.d/postgres"
    ];

    for (const path of paths) {
      assertEquals(await exists(path), true, `${path} should exist`);
    }

    // Verify command arguments were stored
    const commandFile = join(migrationDir, "command.json");
    assertEquals(await exists(commandFile), true, "Command arguments file should exist");
    const commandArgs = JSON.parse(await Deno.readTextFile(commandFile));
    assertEquals(commandArgs.args, [
      "--name", "postgres",
      "--install", installScript,
      "--run", runScript,
      "--ready", readyScript
    ], "Stored command arguments should match original");

    // Verify script contents were stored
    const scripts = {
      install: { path: installScript, content: installContent },
      run: { path: runScript, content: runContent },
      ready: { path: readyScript, content: readyContent }
    };

    for (const [name, script] of Object.entries(scripts)) {
      const storedScript = join(migrationDir, `${name}.sh`);
      assertEquals(await exists(storedScript), true, `${name} script should be stored`);
      const storedContent = await Deno.readTextFile(storedScript);
      assertEquals(storedContent, script.content, `Stored ${name} script should match original`);
    }
  });
});

Deno.test("failed migration", async (t) => {
  // Create install script
  const installScript = "/tmp/failing-install.sh";
  const installContent = `#!/bin/sh
set -e
echo "Creating test directory"
mkdir -p /var/lib/test-service
`;
  await Deno.writeTextFile(installScript, installContent);
  await Deno.chmod(installScript, 0o755);

  // Create intentionally failing run script
  const runScript = "/tmp/failing-run.sh";
  const runContent = `#!/bin/sh
set -e
echo "This script will fail"
exit 1
`;
  await Deno.writeTextFile(runScript, runContent);
  await Deno.chmod(runScript, 0o755);

  // Create rollback script
  const rollbackScript = "/tmp/failing-rollback.sh";
  const rollbackContent = `#!/bin/sh
set -e
echo "Rolling back changes"
rm -rf /var/lib/test-service
`;
  await Deno.writeTextFile(rollbackScript, rollbackContent);
  await Deno.chmod(rollbackScript, 0o755);

  await t.step("verify failed migration handling", async () => {
    // Run migration expecting it to fail
    let error: Error | undefined;
    try {
      await systemMigrate([
        "--name", "failing-service",
        "--install", installScript,
        "--run", runScript,
        "--rollback", rollbackScript
      ]);
    } catch (e) {
      error = e as Error;
    }

    // Verify migration failed
    assertEquals(error !== undefined, true, "Migration should have failed");
    assertEquals(error?.message, "Run script failed", "Should fail with correct error message");

    // Find the migration in rollbacks directory
    const rollbacks = await Deno.readDir("/data/system/migrations/rollbacks");
    let migrationDir = "";
    for await (const entry of rollbacks) {
      if (entry.name.endsWith("_failing-service")) {
        migrationDir = join("/data/system/migrations/rollbacks", entry.name);
        break;
      }
    }
    assertEquals(migrationDir !== "", true, "Migration directory should exist in rollbacks");

    // Verify migration metadata shows failure and rollback
    const metadataFile = join("/data/system/migrations", "metadata.json");
    const metadata = JSON.parse(await Deno.readTextFile(metadataFile));
    const failedMigration = metadata.migrations.find((m: any) => m.name === "failing-service");

    assertEquals(failedMigration !== undefined, true, "Migration should be in metadata");
    assertEquals(failedMigration.status, "failed", "Migration should be marked as failed");
    assertEquals(failedMigration.rollbackReason, "Run script failed", "Should have correct rollback reason");
    assertEquals(typeof failedMigration.rolledBackAt, "string", "Should have rolledBackAt timestamp");

    // Verify script outputs were captured
    const phases = ["install", "run", "rollback"];
    for (const phase of phases) {
      const outputLog = join(migrationDir, `${phase}_output.log`);
      assertEquals(await exists(outputLog), true, `${phase} output log should exist`);

      // Read and verify script output
      const logContent = await Deno.readTextFile(outputLog);
      console.log(`\n${phase} Phase Output:`);
      console.log("==================");
      console.log(logContent);
      console.log("==================\n");
    }

    // Verify rollback was executed
    assertEquals(await exists("/var/lib/test-service"), false, "Directory should be removed by rollback");

    // Verify command arguments were stored
    const commandFile = join(migrationDir, "command.json");
    assertEquals(await exists(commandFile), true, "Command arguments file should exist");
    const commandArgs = JSON.parse(await Deno.readTextFile(commandFile));
    assertEquals(commandArgs.args, [
      "--name", "failing-service",
      "--install", installScript,
      "--run", runScript,
      "--rollback", rollbackScript
    ], "Stored command arguments should match original");

    // Verify script contents were stored
    const scripts = {
      install: { path: installScript, content: installContent },
      run: { path: runScript, content: runContent },
      rollback: { path: rollbackScript, content: rollbackContent }
    };

    for (const [name, script] of Object.entries(scripts)) {
      const storedScript = join(migrationDir, `${name}.sh`);
      assertEquals(await exists(storedScript), true, `${name} script should be stored`);
      const storedContent = await Deno.readTextFile(storedScript);
      assertEquals(storedContent, script.content, `Stored ${name} script should match original`);
    }
  });
});

Deno.test("migration rollback tracking", async (t) => {
  // Create install script that succeeds
  const installScript = "/tmp/rollback-install.sh";
  const installContent = `#!/bin/sh
set -e
echo "Creating test directory"
mkdir -p /var/lib/test-service
`;
  await Deno.writeTextFile(installScript, installContent);
  await Deno.chmod(installScript, 0o755);

  // Create run script that fails
  const runScript = "/tmp/rollback-run.sh";
  const runContent = `#!/bin/sh
set -e
echo "This script will fail"
exit 1
`;
  await Deno.writeTextFile(runScript, runContent);
  await Deno.chmod(runScript, 0o755);

  // Create rollback script
  const rollbackScript = "/tmp/rollback-rollback.sh";
  const rollbackContent = `#!/bin/sh
set -e
echo "Rolling back changes"
rm -rf /var/lib/test-service
`;
  await Deno.writeTextFile(rollbackScript, rollbackContent);
  await Deno.chmod(rollbackScript, 0o755);

  await t.step("verify rollback tracking", async () => {
    // Run migration expecting it to fail
    let error: Error | undefined;
    try {
      await systemMigrate([
        "--name", "rollback-test",
        "--install", installScript,
        "--run", runScript,
        "--rollback", rollbackScript
      ]);
    } catch (e) {
      error = e as Error;
    }

    // Verify migration failed
    assertEquals(error !== undefined, true, "Migration should have failed");
    assertEquals(error?.message, "Run script failed", "Should fail with correct error message");

    // Find the migration in rollbacks directory
    const rollbacks = await Deno.readDir("/data/system/migrations/rollbacks");
    let rollbackDir = "";
    for await (const entry of rollbacks) {
      if (entry.name.endsWith("_rollback-test")) {
        rollbackDir = join("/data/system/migrations/rollbacks", entry.name);
        break;
      }
    }
    assertEquals(rollbackDir !== "", true, "Rollback directory should exist");

    // Verify migration metadata shows rollback
    const metadataFile = join("/data/system/migrations", "metadata.json");
    const metadata = JSON.parse(await Deno.readTextFile(metadataFile));
    const rolledBackMigration = metadata.migrations.find((m: any) => m.name === "rollback-test");

    assertEquals(rolledBackMigration !== undefined, true, "Migration should be in metadata");
    assertEquals(rolledBackMigration.status, "failed", "Migration should be marked as failed");
    assertEquals(rolledBackMigration.rollbackReason, "Run script failed", "Should have correct rollback reason");
    assertEquals(typeof rolledBackMigration.rolledBackAt, "string", "Should have rolledBackAt timestamp");

    // Verify script outputs were captured
    const phases = ["install", "run", "rollback"];
    for (const phase of phases) {
      const outputLog = join(rollbackDir, `${phase}_output.log`);
      assertEquals(await exists(outputLog), true, `${phase} output log should exist`);

      // Read and verify script output
      const logContent = await Deno.readTextFile(outputLog);
      console.log(`\n${phase} Phase Output:`);
      console.log("==================");
      console.log(logContent);
      console.log("==================\n");
    }

    // Verify rollback was executed
    assertEquals(await exists("/var/lib/test-service"), false, "Directory should be removed by rollback");

    // Verify command arguments were stored
    const commandFile = join(rollbackDir, "command.json");
    assertEquals(await exists(commandFile), true, "Command arguments file should exist");
    const commandArgs = JSON.parse(await Deno.readTextFile(commandFile));
    assertEquals(commandArgs.args, [
      "--name", "rollback-test",
      "--install", installScript,
      "--run", runScript,
      "--rollback", rollbackScript
    ], "Stored command arguments should match original");

    // Verify script contents were stored
    const scripts = {
      install: { path: installScript, content: installContent },
      run: { path: runScript, content: runContent },
      rollback: { path: rollbackScript, content: rollbackContent }
    };

    for (const [name, script] of Object.entries(scripts)) {
      const storedScript = join(rollbackDir, `${name}.sh`);
      assertEquals(await exists(storedScript), true, `${name} script should be stored`);
      const storedContent = await Deno.readTextFile(storedScript);
      assertEquals(storedContent, script.content, `Stored ${name} script should match original`);
    }
  });
});
