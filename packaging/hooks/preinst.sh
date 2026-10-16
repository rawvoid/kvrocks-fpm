#!/bin/sh
set -e

# Create kvrocks group before payload extraction if it doesn't exist
if ! getent group kvrocks >/dev/null 2>&1; then
    groupadd -r kvrocks
fi

# Create kvrocks user before payload extraction if it doesn't exist
if ! getent passwd kvrocks >/dev/null 2>&1; then
    nologin_bin="$(command -v nologin 2>/dev/null || echo '/usr/sbin/nologin')"
    [ -x "$nologin_bin" ] || nologin_bin="/bin/false"
    useradd -r -M -g kvrocks -d /var/lib/kvrocks -s "$nologin_bin" -c "Kvrocks Server" kvrocks
fi

exit 0
