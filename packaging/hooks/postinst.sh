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

# Create kvrocks group if it doesn't exist
if ! getent group kvrocks >/dev/null 2>&1; then
    groupadd -r kvrocks >/dev/null 2>&1 || true
fi

# Create kvrocks user if it doesn't exist
if ! getent passwd kvrocks >/dev/null 2>&1; then
    useradd -r -g kvrocks -d /var/lib/kvrocks -s /sbin/nologin -c "Kvrocks Server" kvrocks >/dev/null 2>&1 || true
fi

# Create directories and set permissions
mkdir -p /var/lib/kvrocks /var/log/kvrocks /etc/kvrocks
chown kvrocks:kvrocks /var/lib/kvrocks /var/log/kvrocks /etc/kvrocks 2>/dev/null || true
chmod 750 /var/lib/kvrocks /var/log/kvrocks /etc/kvrocks 2>/dev/null || true

# Secure configuration file and allow CONFIG REWRITE by kvrocks user.
# Refuse symlinks to prevent privilege escalation attacks during package upgrades.
conf=/etc/kvrocks/kvrocks.conf
if [ -e "$conf" ] || [ -L "$conf" ]; then
    if [ -L "$conf" ] || [ ! -f "$conf" ]; then
        echo "kvrocks postinst: $conf must be a regular file, not a symlink" >&2
        exit 1
    fi
    chown kvrocks:kvrocks "$conf"
    chmod 640 "$conf"
fi

# Reload systemd daemon if available, and try-restart service if it was running
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl try-restart kvrocks >/dev/null 2>&1 || true
fi

exit 0
