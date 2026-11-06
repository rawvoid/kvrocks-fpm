# Apache Kvrocks Distro Packages by FPM

Automated packaging pipeline that builds and distributes Debian (`.deb`) and RedHat (`.rpm`) packages for [Apache Kvrocks](https://github.com/apache/kvrocks) using [FPM](https://github.com/jordansissel/fpm) and GitHub Actions.

---

## ✨ Features

- **Multi-Architecture Support**: Native packages for both `x86_64` (`amd64`) and `aarch64` (`arm64`).
- **CPU Microarchitecture Optimization**:
  - **Performance Default (`x86-64-v3`)**: Compiled with `-march=x86-64-v3 -mpclmul -O3` (enabling AVX, AVX2, BMI1/2, FMA, SSE4.2, PCLMUL) for modern servers (~15-30% higher RocksDB throughput).
  - **Compatibility (`legacy`)**: Baseline `x86-64-v1` compatibility (`PORTABLE=1`) for older CPUs/VMs without AVX2.
- **Dual APT & RPM Repositories**: Streamed via global Edge Gateway with automated GPG signing (SecureApt & RPM/repomd detached signatures) and infinite version retention.
- **Universal CPU-Aware One-Click Installer**: Automatically detects host CPU instruction sets (AVX2/BMI2) and Linux distribution family (Debian/Ubuntu & RHEL/Rocky/Alma/Fedora), installing the optimal package variant.
- **Standard Linux Filesystem Layout**: Conforms to FHS (Filesystem Hierarchy Standard).
- **Systemd Integration & Lifecycle Hooks**: Automatic system user `kvrocks` creation, permission initialization, and `systemd` daemon reload.
- **Enterprise Capabilities**: Built with OpenSSL/TLS (`ENABLE_OPENSSL=ON`), Link-Time Optimization (`ENABLE_LTO=ON`), and Jemalloc memory allocator.
- **Production Log Management**: Native daily date-based log rotation (`kvrocks_YYYY-MM-DD.log`) with automated 30-day retention cleanup (`log-retention-days 30`).
- **Upstream Configuration Baseline**: Retains pristine official template at `/usr/share/doc/kvrocks/kvrocks.conf.default` for instant diffing and auditability.
- **Automated Checksums & Detached Debug Symbols**: Every release includes `SHA256SUMS` and companion debug symbol archives (`kvrocks[-legacy]-debuginfo_*.tar.gz`) for non-intrusive production coredump and profiling analysis.

---

## 📦 Package Variants

| Package Name Pattern | Architecture | Target / CPU | Description |
| :--- | :--- | :--- | :--- |
| `kvrocks_<ver>-<iter>_amd64.deb`<br>`kvrocks-<ver>-<iter>.x86_64.rpm` | `x86_64` | `x86-64-v3` (AVX2) | **Default** - Optimized for modern servers (Intel Haswell+, AMD Zen+). |
| `kvrocks-legacy_<ver>-<iter>_amd64.deb`<br>`kvrocks-legacy-<ver>-<iter>.x86_64.rpm` | `x86_64` | `legacy` (x86-64-v1) | Baseline compatibility for older CPUs/VMs without AVX2. |
| `kvrocks_<ver>-<iter>_arm64.deb`<br>`kvrocks-<ver>-<iter>.aarch64.rpm` | `aarch64` | `generic` | 64-bit ARM (AWS Graviton, Aliyun/Tencent ARM, Kunpeng, etc.). |

*(Note: Production packages contain stripped binaries with embedded `.gnu_debuglink`. Detached DWARF debug symbol archives (`kvrocks-debuginfo_<ver>-<iter>_<arch>.tar.gz` and `kvrocks-legacy-debuginfo_<ver>-<iter>_<arch>.tar.gz`) are published as companion release assets for offline coredump analysis and `perf` profiling without restarting services.)*

---

## 🚀 Installation & Usage

> [!TIP]
> **Edge Acceleration & Unlimited Retention**: Package downloads are powered by our global Edge Gateway. All binary packages are permanently hosted on [GitHub Releases](https://github.com/rawvoid/kvrocks-fpm/releases) and cached globally at Cloudflare Edge nodes, providing fast, unblocked downloads worldwide with zero storage restrictions.

> [!NOTE]
> **System Requirements**: Requires Linux with `glibc >= 2.35` (e.g. Ubuntu 22.04+, Debian 12+, Fedora 36+). Older distributions without glibc 2.35 can run Kvrocks via Docker.

### 1. One-Click Automated Install (Debian, Ubuntu, Fedora)

The universal installer automatically detects your Linux distribution family, hardware architecture, and CPU capabilities (AVX2/BMI2), verifies glibc runtime compatibility (>= 2.35), configures the repository, and installs the fastest compatible package variant:

```bash
# Install from Stable channel (default)
curl -fsSL https://rawvoid.github.io/kvrocks-fpm/install.sh | sudo bash

# Install from Testing channel (pre-releases / release candidates)
curl -fsSL https://rawvoid.github.io/kvrocks-fpm/install.sh | sudo KVROCKS_CHANNEL=testing bash
```

Same-name upgrades use `try-restart`: running services are restarted, stopped services stay stopped, and boot enablement is unchanged. Debian service operations honor `policy-rc.d`; a failed service operation never aborts the package transaction.

Do not assume flavor switches preserve service state: APT may remove the old flavor in a separate removal step, stopping and disabling it. After switching, check `systemctl status kvrocks` and `systemctl is-enabled kvrocks`; restore only the states you previously wanted:

```bash
sudo systemctl start kvrocks   # Only if previously running
sudo systemctl enable kvrocks  # Only if previously enabled at boot
```

To switch flavors manually via native package managers:
- **Debian / Ubuntu**: `sudo apt install kvrocks` (or `kvrocks-legacy`)
- **Fedora / DNF**: `sudo dnf swap kvrocks-legacy kvrocks` (or `kvrocks kvrocks-legacy`)

---

## ⚙️ Service Management

The package installs the `systemd` service unit, but does **not** start or enable it on first installation:

```bash
# Start Kvrocks
sudo systemctl start kvrocks

# Enable autostart on boot
sudo systemctl enable kvrocks

# Check status
sudo systemctl status kvrocks

# View systemd service lifecycle
sudo journalctl -u kvrocks -f

# View live database engine logs (native date-based logfile)
sudo tail -f /var/log/kvrocks/kvrocks_$(date +%F).log
```

Test connection using `redis-cli`:
```bash
redis-cli -p 6666 ping
# PONG
```

Removal stops and disables the service (Debian stop requests remain subject to `policy-rc.d`). Debian purge lets dpkg remove managed configuration and clears helper state only when the shared unit is no longer installed. Database files, logs, the service account, and unmanaged files under `/etc/kvrocks` are not recursively deleted.

## 🔍 Production Troubleshooting & Detached Symbol Debugging

Production binaries are stripped (`strip --strip-unneeded`) to minimize package footprint. If a coredump occurs or you need source-line CPU profiling with `perf`, download the matching companion debug archive without restarting or altering the live service:

```bash
# 1. Download and extract companion debug symbols (example for 2.15.0-1 amd64)
tar -xzf kvrocks-debuginfo_2.15.0-1_amd64.tar.gz

# 2. Option A (Standard system debug directory, auto-discovered by GDB/perf):
sudo mkdir -p /usr/lib/debug/usr/bin
sudo cp kvrocks.debug /usr/lib/debug/usr/bin/

# 3. Option B (Inspect coredump with explicit debug directory in GDB):
gdb /usr/bin/kvrocks -ex "set debug-file-directory ." /var/crash/core.kvrocks

# 4. Source-level CPU hotspot profiling with Linux perf:
perf record -g -p $(pgrep kvrocks) -- sleep 30
perf report --symfs .
```

*(Note: Production binaries have embedded `.note.gnu.build-id` and `.gnu_debuglink`. GDB, LLDB, `perf`, and `addr2line` will automatically match and verify the debug symbol file against the running binary.)*

---

## 📁 Filesystem Layout

| Path | Purpose |
| :--- | :--- |
| `/usr/bin/kvrocks` | Main Kvrocks server binary |
| `/usr/bin/kvrocks2redis` | Data migration utility to sync Kvrocks to Redis |
| `/etc/kvrocks/kvrocks.conf` | Active production configuration (protected during package upgrades) |
| `/usr/share/doc/kvrocks/kvrocks.conf.default` | Pristine upstream configuration reference (for diffing & auditing) |
| `/usr/share/doc/kvrocks/kvrocks2redis.conf.default` | Pristine upstream Redis migration configuration reference |
| `/usr/lib/systemd/system/kvrocks.service` | Systemd service unit |
| `/var/lib/kvrocks/` | Working & database storage directory (owned by `kvrocks:kvrocks`) |
| `/var/log/kvrocks/` | Server log directory (`kvrocks_YYYY-MM-DD.log`, owned by `kvrocks:kvrocks`) |
| `/usr/share/doc/kvrocks/` | License, Notice, and upstream reference documentation |

> **Tip**: You can compare your active configuration against the pristine upstream defaults with colored output at any time:
> ```bash
> diff -u --color /usr/share/doc/kvrocks/kvrocks.conf.default /etc/kvrocks/kvrocks.conf
> ```

### ⚙️ Configuration Lifecycle & Upgrades (`CONFIG REWRITE` & `.rpmnew`)

The active configuration file `/etc/kvrocks/kvrocks.conf` is marked as a protected configuration file (`conffile` in Debian/Ubuntu, `%config(noreplace)` in RPM/RHEL/Fedora).

- **Default permissions**: The configuration is `kvrocks:kvrocks` mode `0640`; `/etc/kvrocks` is `root:kvrocks` mode `0775`, allowing same-directory file replacement for `CONFIG REWRITE`. RPM records these owner/group names in package metadata rather than repairing the active configuration in postinst. Configuration changes after `CONFIG REWRITE` can legitimately appear in `rpm -V`.
- **Debian permission initialization**: Preinst creates the service user and group before payload extraction. Postinst initializes directory permissions (`/etc/kvrocks` as `root:kvrocks 0775`, state/log as `0750`) and configuration permissions (`kvrocks:kvrocks 0640`), strictly refusing symlinks to prevent privilege escalation.
- **Protection Against Overwrites**: When Kvrocks executes `CONFIG REWRITE` or when you customize the configuration (e.g., setting `requirepass` or adjusting caching parameters), your active changes will **never** be silently overwritten during package upgrades.
- **Debian / Ubuntu**: Upgrades performed via `install.sh` automatically preserve your active configuration non-interactively using dpkg's `--force-confdef --force-confold` flags. A bare `apt-get upgrade` may still present the conffile prompt; answer "keep the currently-installed version" to retain your settings.
- **RHEL / Rocky / AlmaLinux / Fedora**: If your active configuration differs from the newly installed release defaults, RPM preserves your current `/etc/kvrocks/kvrocks.conf` and saves the maintainer's new template to `/etc/kvrocks/kvrocks.conf.rpmnew`. You can review the new directives and safely remove the `.rpmnew` file:
  ```bash
  # Review new upstream directives against your active configuration
  diff -u /etc/kvrocks/kvrocks.conf /etc/kvrocks/kvrocks.conf.rpmnew

  # Remove the .rpmnew file once reviewed
  sudo rm -f /etc/kvrocks/kvrocks.conf.rpmnew
  ```

---

## 🛠️ Build & Release

Packages are built and published on-demand via GitHub Actions (`workflow_dispatch`):

* **GitHub Web UI**: Go to **Actions** -> **Release Packages** -> **Run workflow**, enter `version` (e.g. `2.15.0`) and `iteration` (e.g. `1`); tick `dry_run` to build packages and merge indexes without publishing.
* **GitHub CLI (`gh`)**:
  ```bash
  # Build and publish GA release (automatically published as Stable)
  gh workflow run release.yaml -f version=2.15.0 -f iteration=1

  # Build and publish RC/pre-release (automatically published as GitHub Pre-release and Testing channel)
  gh workflow run release.yaml -f version=2.15.0-rc1 -f iteration=1

  # Dry-run: build packages and merge APT/RPM indexes, without signing or pushing.
  # The version-iteration must not already have a GitHub Release or git tag.
  gh workflow run release.yaml -f version=2.15.0 -f iteration=1 -f dry_run=true
  ```

Publishing creates a draft GitHub Release, makes it public, and then deploys metadata to `gh-pages`. Metadata is pushed once; a failure stops the workflow without retrying, deleting, or re-creating the public Release.

Repository requirements: the `gh-pages` branch must exist (it is checked even for dry runs and can be empty of packages), repository variable `KVROCKS_GATEWAY_URL` must point at the edge gateway, and secret `GPG_PRIVATE_KEY` (plus optional `GPG_PASSPHRASE`) must hold exactly one signing key. RPM metadata is built with `mergerepo_c --omit-baseurl`, so package locations stay filenames under the repository `baseurl`.

Before publishing, the workflow installs, upgrades, switches between flavors, and removes the generated packages in Ubuntu 22.04, Debian 13, and Fedora containers. Service management is not exercised: `systemctl` and `deb-systemd-invoke` are replaced by logging stubs, so these tests cover the maintainer scripts' decisions rather than a live systemd lifecycle. The test baseline uses the same payload and maintainer hooks at package iteration `0` and is never uploaded to a release or repository.

**Pre-release versions**: `2.15.0-rc1` packages are built with internal package version `2.15.0~rc1` (the `~` ensures APT/DNF recognize that `2.15.0~rc1 < 2.15.0`, so upgrading to the GA release is seamless when both versions are visible to the package manager). The installer always configures the stable APT channel and adds testing when selected, so testing users can see later GA releases. The suffix is a single identifier such as `rc1` or `rc.1`; a hyphen is rejected because RPM `Version` cannot contain `-`. External artifacts and release tags retain the standard naming (e.g. `kvrocks_2.15.0-rc1-1_amd64.deb`, tag `v2.15.0-rc1-1`).

---

## 📄 License

This repository and packaging scripts are licensed under the [Apache-2.0 License](LICENSE). Apache Kvrocks is licensed under Apache-2.0.
