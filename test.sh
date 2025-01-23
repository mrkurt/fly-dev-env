#!/bin/bash
set -e

echo "=== System Info ==="
whoami
id
pwd
echo

echo "=== SSH Info ==="
ls -l /etc/ssh/ssh_host_*
ls -l /usr/local/bin/generate-cert
echo

echo "=== Process Tree ==="
ps aux | grep -E '(sshd|s6)' 