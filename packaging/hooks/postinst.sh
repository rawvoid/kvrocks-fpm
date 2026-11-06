#!/bin/sh
set -e

# RPM only ($1 is numeric): %post of the replacing flavor runs before %preun of the
# obsolete one, so leave a marker telling that %preun not to stop or disable the service.
# %posttrans removes it again.
case "$1" in
    ''|*[!0-9]*) ;;
    *)
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

# Debian postinst runs after the package files are configured; RPM service handling is in %posttrans.
# try-restart is a no-op for a stopped unit, so this also covers flavor switches, where the
# replacing package is configured without a previous version ($2 empty).
if [ "$1" = configure ] && [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    deb-systemd-invoke try-restart kvrocks.service >/dev/null 2>&1 || true
fi

exit 0
