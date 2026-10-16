#!/bin/sh
set -e

# A residual old flavor must not purge the new flavor's shared helper state or unit.
if [ "$1" = purge ]; then
    if [ -e /usr/lib/systemd/system/kvrocks.service ]; then
        exit 0
    fi
    deb-systemd-helper purge kvrocks.service >/dev/null 2>&1 || true
fi

# Reload systemd daemon if available and clean failed state
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl reset-failed kvrocks >/dev/null 2>&1 || true
fi

exit 0
