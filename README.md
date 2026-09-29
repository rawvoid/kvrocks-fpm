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

### 1. One-Click Automated Install (Debian, Ubuntu, Fedora)

The universal installer automatically detects your Linux distribution family, hardware architecture, and CPU capabilities (AVX2/BMI2), verifies glibc runtime compatibility (>= 2.35), configures the repository, and installs the fastest compatible package variant:

```bash
# Install from Stable channel (default)
curl -fsSL https://rawvoid.github.io/kvrocks-fpm/install.sh | sudo bash

# Install from Testing channel (pre-releases / release candidates)
curl -fsSL https://rawvoid.github.io/kvrocks-fpm/install.sh | sudo KVROCKS_CHANNEL=testing bash
```

*(Note: Upgrades and flavor switches automatically restart the service if running, and preserve the inactive state if stopped.)*

---

## ⚙️ Service Management

The package automatically sets up the `systemd` service unit:

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

---

## 🛠️ Build & Release

Packages are built and published on-demand via GitHub Actions (`workflow_dispatch`):

* **GitHub Web UI**: Go to **Actions** -> **Release Packages** -> **Run workflow**, enter `version` (e.g. `2.15.0`) and `iteration` (e.g. `1`).
* **GitHub CLI (`gh`)**:
  ```bash
  # Build and publish GA release (automatically published as Stable)
  gh workflow run release.yaml -f version=2.15.0 -f iteration=1

  # Build and publish RC/pre-release (automatically published as GitHub Pre-release and Testing channel)
  gh workflow run release.yaml -f version=2.15.0-rc1 -f iteration=1

  # Dry-run / test build only (without creating GitHub release or updating repositories)
  gh workflow run release.yaml -f version=2.15.0 -f iteration=1 -f publish_release=false
  ```

---

## 📄 License

This repository and packaging scripts are licensed under the [Apache-2.0 License](LICENSE). Apache Kvrocks is licensed under Apache-2.0.
