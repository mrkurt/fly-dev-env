# Fly.io Development Environment

This repository contains a development environment setup for Fly.io machines with overlayfs and SSH support.

## Features

- Overlay filesystem for persistent changes
- SSH access over IPv6
- s6-overlay for service management
- 50GB volume for data storage
- 8GB RAM and 8 shared CPUs

## Project Structure

- `Dockerfile` - Container image definition
- `overlayfs-init` - Script for setting up overlay filesystem
- `fly.toml` - Fly.io app configuration
- `machines` - CLI script for building and deploying
- `cli/` - Deno-based deployment tooling
  - `machine-config-template.json` - Template for machine configuration
- `reference/` - API documentation and examples
- `.dockerignore` - Excludes non-build files from image

## Deployment

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd fly-dev-env
   ```

2. Deploy to Fly.io:
   ```bash
   # Build the image
   ./machines build --app fly-dev-env

   # Create a volume (if not exists)
   fly volumes create data --size 50

   # Deploy a new machine
   ./machines deploy --app fly-dev-env
   ```

## SSH Configuration

1. Get your machine's IPv6 address:
   ```bash
   fly machine list
   ```

2. Create an SSH key pair if you don't have one:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/fly_dev_env
   ```

3. Create the .ssh directory and set permissions:
   ```bash
   # Using the machines API exec endpoint
   curl -X POST \
     -H "Authorization: Bearer $(fly auth token)" \
     -H "Content-Type: application/json" \
     https://api.machines.dev/v1/apps/fly-dev-env/machines/MACHINE_ID/exec \
     -d '{"cmd": "mkdir -p /home/dev/.ssh && chmod 700 /home/dev/.ssh && chown dev:dev /home/dev/.ssh"}'
   ```

4. Install your SSH public key:
   ```bash
   # Replace MACHINE_ID with your machine's ID and adjust the path to your public key
   curl -X POST \
     -H "Authorization: Bearer $(fly auth token)" \
     -H "Content-Type: application/json" \
     https://api.machines.dev/v1/apps/fly-dev-env/machines/MACHINE_ID/exec \
     -d "{\"cmd\": \"echo '$(cat ~/.ssh/fly_dev_env.pub)' > /home/dev/.ssh/authorized_keys && chmod 600 /home/dev/.ssh/authorized_keys && chown dev:dev /home/dev/.ssh/authorized_keys\"}"
   ```

5. Add to your SSH config (~/.ssh/config):
   ```
   Host fly-dev
     HostName MACHINE_IPV6_ADDRESS
     User dev
     IdentityFile ~/.ssh/fly_dev_env
   ```

6. Connect to your machine:
   ```bash
   ssh fly-dev
   ```

## Volume Management

The `/data` directory is mounted from a persistent volume and is available in both the base system and the overlay filesystem. Any data you want to persist should be stored here.

## Troubleshooting

1. Check machine status:
   ```bash
   fly machine status MACHINE_ID
   ```

2. View logs:
   ```bash
   fly logs
   ```

3. If SSH connection fails:
   - Verify the machine is running: `fly machine list`
   - Check SSH service logs: `fly logs | grep sshd`
   - Verify IPv6 connectivity: `ping6 MACHINE_IPV6_ADDRESS`
   - Ensure key permissions: `chmod 600 ~/.ssh/fly_dev_env` 