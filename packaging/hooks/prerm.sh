#!/bin/sh
set -e

# Stop and disable only on removal, not on same-name upgrades or coordinated replacements:
# - Debian remove in-favour skips stopping; APT may instead remove the old flavor separately.
# - RPM package obsolete: $1=0, but new package %post created /run/kvrocks.dont-disable
should_stop=0
if [ "$1" = "remove" ] && [ "${2:-}" != "in-favour" ]; then
    should_stop=1
elif [ "$1" = "0" ] && [ ! -f /run/kvrocks.dont-disable ]; then
    should_stop=1
fi

if [ "$should_stop" -eq 1 ]; then
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
        if [ "$1" = remove ]; then
            deb-systemd-invoke stop kvrocks.service >/dev/null 2>&1 || true
        else
            systemctl stop kvrocks >/dev/null 2>&1 || true
            systemctl disable kvrocks >/dev/null 2>&1 || true
        fi
    fi
    if [ "$1" = remove ]; then
        deb-systemd-helper disable kvrocks.service >/dev/null 2>&1 || true
    fi
fi

exit 0
