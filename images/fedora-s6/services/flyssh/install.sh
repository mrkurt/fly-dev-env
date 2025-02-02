#!/bin/bash
set -euo pipefail

# Create directories
mkdir -p /etc/default

# Download latest flyssh release
if ! curl -L -f https://github.com/superfly/flyssh/releases/download/v0.1.4/flyssh-linux-amd64 -o /usr/local/bin/flyssh; then
    echo "Failed to download flyssh binary"
    exit 1
fi

if [ ! -f /usr/local/bin/flyssh ]; then
    echo "flyssh binary not found after download"
    exit 1
fi

chmod +x /usr/local/bin/flyssh 