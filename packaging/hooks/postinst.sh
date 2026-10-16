#!/bin/sh
set -e

# In RPM transactions (%post receives numeric $1), record replacement marker
# so obsolete old package's %preun does not disable or stop the service.
case "$1" in
    ''|*[!0-9]*) ;;
    *)
        mkdir -p /run 2>/dev/null || true
        touch /run/kvrocks.dont-disable 2>/dev/null || true
        ;;
esac

# Initialize service ownership for DEB (RPM uses staged package metadata)
case "$1" in
    ''|*[!0-9]*)
        mkdir -p /var/lib/kvrocks /var/log/kvrocks /etc/kvrocks
        chown kvrocks:kvrocks /var/lib/kvrocks /var/log/kvrocks
        chmod 750 /var/lib/kvrocks /var/log/kvrocks
        chown root:kvrocks /etc/kvrocks
        chmod 775 /etc/kvrocks

        conf=/etc/kvrocks/kvrocks.conf
        if [ -L "$conf" ]; then
            echo "kvrocks postinst: $conf must be a regular file, not a symlink" >&2
            exit 1
        elif [ -f "$conf" ]; then
            chown kvrocks:kvrocks "$conf"
            chmod 640 "$conf"
        fi
        ;;
esac

# Record systemd enablement state on Debian without starting service
if [ "$1" = configure ]; then
    deb-systemd-helper unmask kvrocks.service >/dev/null 2>&1 || true
    deb-systemd-helper update-state kvrocks.service >/dev/null 2>&1 || true
fi

# Reload systemd and try-restart if already active
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    if [ "$1" = configure ] && [ -n "${2:-}" ]; then
        deb-systemd-invoke try-restart kvrocks.service >/dev/null 2>&1 || true
    elif [ "$1" != configure ] && [ "$1" != "1" ]; then
        systemctl try-restart kvrocks >/dev/null 2>&1 || true
    fi
fi

exit 0
