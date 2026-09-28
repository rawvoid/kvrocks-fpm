#!/bin/sh
set -e

# Reload systemd daemon if available and clean failed state
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl reset-failed kvrocks >/dev/null 2>&1 || true
fi

exit 0
