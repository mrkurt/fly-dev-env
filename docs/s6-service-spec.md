# S6 Service Specification

This document outlines how to create and manage s6 services in our environment using s6-overlay v3.

## Service Directory Structure

Services are installed in `/etc/s6-overlay/s6-rc.d/<service-name>/` with the following structure:

```
/etc/s6-overlay/s6-rc.d/
├── <service-name>/
│   ├── type           # Contains "longrun" for long-running services
│   ├── run            # Main service script (required)
│   ├── finish         # Cleanup script (optional)
│   └── dependencies.d/  # Directory listing service dependencies (optional)
└── user/
    └── contents.d/
        └── <service-name>  # Empty file to enable service in user bundle
```

## Creating a Service

1. Create the service directory:
   ```sh
   mkdir -p /etc/s6-overlay/s6-rc.d/<service-name>
   ```

2. Create the type file (for long-running services):
   ```sh
   echo "longrun" > /etc/s6-overlay/s6-rc.d/<service-name>/type
   ```

3. Create the run script:
   ```sh
   cat > /etc/s6-overlay/s6-rc.d/<service-name>/run << 'EOF'
   #!/bin/sh
   
   # Use with-contenv to ensure environment variables are available
   exec with-contenv YOUR_COMMAND
   EOF
   chmod +x /etc/s6-overlay/s6-rc.d/<service-name>/run
   ```

4. (Optional) Create a finish script for cleanup:
   ```sh
   cat > /etc/s6-overlay/s6-rc.d/<service-name>/finish << 'EOF'
   #!/bin/sh
   # $1 = exit code
   # $2 = signal (if any)
   
   # Store exit status for monitoring
   echo "$1" > /run/<service-name>/status
   
   # Perform cleanup here
   EOF
   chmod +x /etc/s6-overlay/s6-rc.d/<service-name>/finish
   ```

5. Enable the service in the user bundle:
   ```sh
   mkdir -p /etc/s6-overlay/s6-rc.d/user/contents.d
   touch /etc/s6-overlay/s6-rc.d/user/contents.d/<service-name>
   ```

## Starting Services

Services enabled in the user bundle start automatically with the container. The startup order is:

1. Container starts
2. s6-overlay initializes
3. Services in `/etc/s6-overlay/s6-rc.d/user/contents.d/` are started
4. Service's run script is executed

To manually control services:
```sh
# Start a service
s6-rc -u change <service-name>

# Stop a service
s6-rc -d change <service-name>

# Restart a service
s6-rc -d change <service-name> && s6-rc -u change <service-name>
```

## Monitoring Service Health

1. Check service status:
   ```sh
   s6-svstat /run/service/<service-name>
   ```

2. Monitor service logs:
   ```sh
   s6-logwatch /run/service/<service-name>/log
   ```

3. Check exit status (if service has crashed):
   ```sh
   cat /run/<service-name>/status  # If using finish script
   ```

4. Common status codes:
   - 0: Service exited normally
   - 256: Service crashed or failed to start
   - 125: Service was killed by a signal

## Best Practices

1. **Environment Variables**:
   - Always use `with-contenv` in run scripts to ensure environment variables are available
   - Store service-specific environment variables in `/etc/s6/env.d/`

2. **Logging**:
   - s6-overlay v3 automatically handles log redirection for services
   - To disable automatic logging and just use stdout/stderr, set `S6_LOGGING=0`
   - If logging is enabled:
     - Service logs are stored in `/var/log/s6-services/<service-name>/`
     - For persistent logs, bind mount `/var/log/s6-services` to `/data/state/s6-logs`
   - For critical services, consider implementing structured logging in your application

3. **Dependencies**:
   - List dependencies in `dependencies.d/` directory
   - Use oneshot services for initialization tasks

4. **Error Handling**:
   - Always implement a finish script for critical services
   - Store exit status for monitoring
   - Implement appropriate cleanup in finish scripts

## Example Service Definition

Here's a complete example for a PostgreSQL service:

```sh
# Create service structure
mkdir -p /etc/s6-overlay/s6-rc.d/postgresql
cd /etc/s6-overlay/s6-rc.d/postgresql

# Create type file
echo "longrun" > type

# Create run script
cat > run << 'EOF'
#!/bin/sh

# Initialize if needed
if [ ! -f "/var/lib/postgresql/PG_VERSION" ]; then
    with-contenv initdb -D /var/lib/postgresql
fi

# Start PostgreSQL
exec with-contenv postgres -D /var/lib/postgresql
EOF
chmod +x run

# Create finish script
cat > finish << 'EOF'
#!/bin/sh
# Store exit status
echo "$1" > /run/postgresql/status

# Cleanup
if [ -f "/var/lib/postgresql/postmaster.pid" ]; then
    rm /var/lib/postgresql/postmaster.pid
fi
EOF
chmod +x finish

# Enable service
mkdir -p /etc/s6-overlay/s6-rc.d/user/contents.d
touch /etc/s6-overlay/s6-rc.d/user/contents.d/postgresql
```

## Troubleshooting

1. **Service won't start**:
   - Check permissions on run script
   - Verify dependencies are available
   - Look for errors in service log

2. **Service crashes immediately**:
   - Check run script syntax
   - Verify paths and permissions
   - Look for missing dependencies

3. **Environment variables not available**:
   - Ensure `with-contenv` is used
   - Check if variables are set in `/etc/s6/env.d/`

4. **Service won't stop**:
   - Check if process is properly exec'd
   - Verify finish script permissions
   - Look for hung child processes 