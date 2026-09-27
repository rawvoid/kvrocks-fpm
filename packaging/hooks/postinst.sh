#!/bin/sh
set -e

# In RPM transactions (%post receives numeric $1), record replacement marker
# so obsolete old package's %preun does not disable or stop the service.
case "$1" in
    ''|*[!0-9]*) ;;
    *) mkdir -p /run && touch /run/kvrocks.dont-disable 2>/dev/null || true ;;
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

# Secure configuration file and allow CONFIG REWRITE by kvrocks user
if [ -f /etc/kvrocks/kvrocks.conf ]; then
    chown kvrocks:kvrocks /etc/kvrocks/kvrocks.conf 2>/dev/null || true
    chmod 640 /etc/kvrocks/kvrocks.conf 2>/dev/null || true
fi

# Reload systemd daemon if available
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || true
fi

exit 0
