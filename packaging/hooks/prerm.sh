#!/bin/sh
set -e

# Only stop and disable the service upon complete package removal, NOT on upgrade.
# In Debian/Ubuntu: $1 = "remove"
# In RPM: $1 = 0
if [ "$1" = "remove" ] || [ "$1" = "0" ]; then
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
        systemctl stop kvrocks >/dev/null 2>&1 || true
        systemctl disable kvrocks >/dev/null 2>&1 || true
    fi
fi

exit 0
