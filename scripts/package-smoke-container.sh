#!/usr/bin/env bash
#
# Copyright 2026 Rawvoid(https://github.com/rawvoid)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

set -euo pipefail

mode="$1"
version="$2"
iteration="$3"
# Mirrors BASELINE_ITERATION in .github/workflows/release.yaml.
baseline_iteration=0
actions=/tmp/kvrocks-service-actions.log
: > "$actions"
mkdir -p /run/systemd/system

# Record service actions instead of performing them. dpkg and rpm run maintainer scripts
# with a fixed PATH that excludes /usr/local/bin, so the stubs must live in /usr/bin.
install_service_stub() {
    local name="$1"
    cat > "/usr/bin/${name}" <<EOF
#!/bin/sh
printf '${name} %s\n' "\$*" >> "${actions}"
exit 0
EOF
    chmod 0755 "/usr/bin/${name}"
}

install_service_stub systemctl

require_packages() {
    local package
    for package in "$@"; do
        test -s "$package" || { echo "Missing package asset: ${package}" >&2; exit 1; }
    done
}

assert_no_stop_or_disable() {
    if grep -Eq '^(systemctl|deb-systemd-invoke) (stop|disable)( |$)' "$actions"; then
        echo "Unexpected service stop/disable during package replacement:" >&2
        cat "$actions" >&2
        exit 1
    fi
}

assert_service_restart() {
    if ! grep -Eq '^(systemctl|deb-systemd-invoke) try-restart ' "$actions"; then
        echo "Expected package transaction to try-restart the service:" >&2
        cat "$actions" >&2
        exit 1
    fi
}

run_deb_tests() {
    apt-get update
    # Installed up front so the stub below can replace the real helper. That the package
    # declares this dependency is asserted from its control fields further down.
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends init-system-helpers
    install_service_stub deb-systemd-invoke

    main_baseline="/test-baseline/kvrocks_${version}-${baseline_iteration}_amd64.deb"
    legacy_baseline="/test-baseline/kvrocks-legacy_${version}-${baseline_iteration}_amd64.deb"
    main_actual="/dist/kvrocks_${version}-${iteration}_amd64.deb"
    legacy_actual="/dist/kvrocks-legacy_${version}-${iteration}_amd64.deb"
    require_packages "$main_baseline" "$legacy_baseline" "$main_actual" "$legacy_actual"

    control_dir=$(mktemp -d)
    dpkg-deb --control "$main_actual" "$control_dir"
    grep -Fxq /etc/kvrocks/kvrocks.conf "$control_dir/conffiles"
    dpkg-deb --field "$main_actual" Conflicts | grep -Fxq kvrocks-legacy
    dpkg-deb --field "$legacy_actual" Conflicts | grep -Fxq kvrocks
    dpkg-deb --field "$main_actual" Depends | grep -Fq init-system-helpers
    rm -rf "$control_dir"

    apt_install() {
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
            -o Dpkg::Options::=--force-confdef \
            -o Dpkg::Options::=--force-confold "$1"
    }
    installed_deb_version() {
        dpkg-query -W -f='${Version}' "$1"
    }
    expect_installed_deb_version() {
        local package_name="$1" package_file="$2"
        local expected actual
        expected=$(dpkg-deb --field "$package_file" Version)
        actual=$(installed_deb_version "$package_name")
        test "$actual" = "$expected" || {
            echo "Expected ${package_name} ${expected}, found ${actual}" >&2
            exit 1
        }
    }

    apt_install "$main_baseline"
    getent passwd kvrocks >/dev/null
    test "$(stat -c '%U:%G:%a' /etc/kvrocks/kvrocks.conf)" = kvrocks:kvrocks:640
    test "$(stat -c '%U:%G:%a' /var/lib/kvrocks)" = kvrocks:kvrocks:750
    /usr/bin/kvrocks --version
    printf '\n# lifecycle-smoke-preserved\n' >> /etc/kvrocks/kvrocks.conf

    : > "$actions"
    apt_install "$main_actual"
    expect_installed_deb_version kvrocks "$main_actual"
    grep -Fxq '# lifecycle-smoke-preserved' /etc/kvrocks/kvrocks.conf
    assert_service_restart

    : > "$actions"
    apt_install "$legacy_actual"
    test "$(dpkg-query -W -f='${db:Status-Status}' kvrocks-legacy)" = installed
    expect_installed_deb_version kvrocks-legacy "$legacy_actual"
    old_status=$(dpkg-query -W -f='${db:Status-Status}' kvrocks 2>/dev/null || true)
    if [ "$old_status" = installed ]; then
        echo "Conflicting kvrocks flavor remained installed after replacement" >&2
        exit 1
    fi
    grep -Fxq '# lifecycle-smoke-preserved' /etc/kvrocks/kvrocks.conf
    # APT removes the replaced flavor in its own step (no "remove in-favour"), so the old prerm
    # stops and disables the service: a Debian flavor switch does not preserve service state.
    assert_service_restart

    : > "$actions"
    apt_install "$main_actual"
    test "$(dpkg-query -W -f='${db:Status-Status}' kvrocks)" = installed
    grep -Fxq '# lifecycle-smoke-preserved' /etc/kvrocks/kvrocks.conf
    assert_service_restart

    : > "$actions"
    DEBIAN_FRONTEND=noninteractive apt-get remove -y kvrocks
    grep -Eq '^deb-systemd-invoke stop kvrocks\.service' "$actions"
    echo "DEB install, upgrade, both flavor switches, config preservation, and removal passed."
}

run_rpm_tests() {
    main_baseline="/test-baseline/kvrocks-${version}-${baseline_iteration}.x86_64.rpm"
    legacy_baseline="/test-baseline/kvrocks-legacy-${version}-${baseline_iteration}.x86_64.rpm"
    main_actual="/dist/kvrocks-${version}-${iteration}.x86_64.rpm"
    legacy_actual="/dist/kvrocks-legacy-${version}-${iteration}.x86_64.rpm"
    require_packages "$main_baseline" "$legacy_baseline" "$main_actual" "$legacy_actual"
    dnf install -y --nogpgcheck "$main_baseline"

    rpm -qp --configfiles "$main_actual" | grep -Fxq /etc/kvrocks/kvrocks.conf
    rpm -qp --conflicts "$main_actual" | grep -Fxq kvrocks-legacy
    rpm -qp --conflicts "$legacy_actual" | grep -Fxq kvrocks

    expected_rpm_version() {
        rpm -qp --qf '%{VERSION}-%{RELEASE}' "$1"
    }
    assert_rpm_version() {
        local package_name="$1" package_file="$2"
        local expected actual
        expected=$(expected_rpm_version "$package_file")
        actual=$(rpm -q --qf '%{VERSION}-%{RELEASE}' "$package_name")
        test "$actual" = "$expected" || {
            echo "Expected ${package_name} ${expected}, found ${actual}" >&2
            exit 1
        }
    }

    getent passwd kvrocks >/dev/null
    test "$(stat -c '%U:%G:%a' /etc/kvrocks/kvrocks.conf)" = kvrocks:kvrocks:640
    test "$(stat -c '%U:%G:%a' /var/lib/kvrocks)" = kvrocks:kvrocks:750
    /usr/bin/kvrocks --version
    printf '\n# lifecycle-smoke-preserved\n' >> /etc/kvrocks/kvrocks.conf

    : > "$actions"
    dnf install -y --allowerasing --nogpgcheck "$main_actual"
    assert_rpm_version kvrocks "$main_actual"
    grep -Fxq '# lifecycle-smoke-preserved' /etc/kvrocks/kvrocks.conf
    assert_service_restart

    : > "$actions"
    dnf install -y --allowerasing --nogpgcheck "$legacy_actual"
    rpm -q kvrocks-legacy >/dev/null
    assert_rpm_version kvrocks-legacy "$legacy_actual"
    if rpm -q kvrocks >/dev/null 2>&1; then
        echo "Conflicting kvrocks flavor remained installed after replacement" >&2
        exit 1
    fi
    grep -Fxq '# lifecycle-smoke-preserved' /etc/kvrocks/kvrocks.conf
    assert_no_stop_or_disable
    assert_service_restart
    test ! -e /run/kvrocks.dont-disable

    : > "$actions"
    dnf install -y --allowerasing --nogpgcheck "$main_actual"
    rpm -q kvrocks >/dev/null
    grep -Fxq '# lifecycle-smoke-preserved' /etc/kvrocks/kvrocks.conf
    assert_no_stop_or_disable
    assert_service_restart

    : > "$actions"
    dnf remove -y kvrocks
    grep -Eq '^systemctl stop kvrocks$' "$actions"
    grep -Eq '^systemctl disable kvrocks$' "$actions"
    echo "RPM install, upgrade, both flavor switches, config preservation, and removal passed."
}

case "$mode" in
    deb) run_deb_tests ;;
    rpm) run_rpm_tests ;;
    *) echo "Unknown package mode: ${mode}" >&2; exit 2 ;;
esac
