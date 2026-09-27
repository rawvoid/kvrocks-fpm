#!/bin/sh
set -e

# Stop and disable service only upon genuine package removal, NOT on upgrade or flavor switching:
# - Debian package replacement: $1=remove, $2=in-favour
# - RPM package obsolete: $1=0, but new package %post created /run/kvrocks.dont-disable
should_stop=0
if [ "$1" = "remove" ] && [ "${2:-}" != "in-favour" ]; then
    should_stop=1
elif [ "$1" = "0" ] && [ ! -f /run/kvrocks.dont-disable ]; then
    should_stop=1
fi

if [ "$should_stop" -eq 1 ]; then
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
        systemctl stop kvrocks >/dev/null 2>&1 || true
        systemctl disable kvrocks >/dev/null 2>&1 || true
    fi
fi

exit 0
