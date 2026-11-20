#!/bin/sh
set -e

# DEB ($1 is configure): initialize service-owned paths on fresh install/flavor switch ($2 empty)
# so admin permission overrides survive same-name upgrades (RPM uses staged package metadata).
# RPM ($1 is numeric): %post of the replacing flavor runs before %preun of the obsolete one,
# so leave a marker telling that %preun not to stop or disable the service; %posttrans removes it.
case "$1" in
    configure)
        mkdir -p /var/lib/kvrocks /var/log/kvrocks /etc/kvrocks
        if [ -z "${2:-}" ]; then
            chown kvrocks:kvrocks /var/lib/kvrocks /var/log/kvrocks
            chmod 750 /var/lib/kvrocks /var/log/kvrocks
            chown root:kvrocks /etc/kvrocks
            chmod 775 /etc/kvrocks

            conf=/etc/kvrocks/kvrocks.conf
            if [ -L "$conf" ]; then
                echo "kvrocks postinst: $conf must be a regular file, not a symlink" >&2
                exit 1
            elif [ -f "$conf" ]; then
                chown -h kvrocks:kvrocks "$conf"
                chmod 640 "$conf"
            fi
        fi

        # Record systemd enablement state on Debian without starting service
        deb-systemd-helper unmask kvrocks.service >/dev/null 2>&1 || true
        deb-systemd-helper update-state kvrocks.service >/dev/null 2>&1 || true

        # Debian postinst runs after the package files are configured; RPM service handling is in %posttrans.
        # try-restart is a no-op for a stopped unit, so this also covers flavor switches, where the
        # replacing package is configured without a previous version ($2 empty).
        if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
            systemctl daemon-reload >/dev/null 2>&1 || true
            deb-systemd-invoke try-restart kvrocks.service >/dev/null 2>&1 || true
        fi
        ;;
    [0-9]*)
        touch /run/kvrocks.dont-disable 2>/dev/null || true
        ;;
esac

exit 0
