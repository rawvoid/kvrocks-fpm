#!/bin/sh
# Drop the flavor-replacement marker written by %post once the transaction is over.
rm -f /run/kvrocks.dont-disable

# %posttrans runs after every package in the transaction is on disk, so this is the first
# point where a restart is guaranteed to pick up the new binary rather than the removed one.
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl try-restart kvrocks >/dev/null 2>&1 || true
fi
exit 0
