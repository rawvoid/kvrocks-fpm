# Apache Kvrocks Distro Packages by FPM

Automated packaging pipeline that builds and distributes Debian (`.deb`) and RedHat (`.rpm`) packages for [Apache Kvrocks](https://github.com/apache/kvrocks) using [FPM](https://github.com/jordansissel/fpm) and GitHub Actions.

---

## ✨ Features

- **Multi-Architecture Support**: Native packages for both `x86_64` (`amd64`) and `aarch64` (`arm64`).
- **CPU Microarchitecture Optimization**:
  - **Performance Default (`x86-64-v3`)**: Compiled with `-march=x86-64-v3 -mpclmul -O3` (enabling AVX, AVX2, BMI1/2, FMA, SSE4.2, PCLMUL) for modern servers (~15-30% higher RocksDB throughput).
  - **Compatibility (`legacy`)**: Baseline `x86-64-v1` compatibility (`PORTABLE=1`) for older CPUs/VMs without AVX2.
- **Dual APT & RPM Repositories**: Hosted on GitHub Pages with automated GPG signing (SecureApt & RPM/repomd detached signatures), index updates, and multi-version management.
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
> **Repository Retention Policy**: Online APT and RPM repositories hosted on GitHub Pages maintain the latest package iteration for the **latest 5 upstream releases** to stay strictly within GitHub Pages storage quotas (~715 MB). All historical releases, revisions, tar archives, and detached debug symbols remain permanently accessible on [GitHub Releases](https://github.com/rawvoid/kvrocks-fpm/releases).

### 1. One-Click Automated Install (Debian, Ubuntu, Fedora)

The universal installer automatically detects your Linux distribution family, hardware architecture, and CPU capabilities (AVX2/BMI2), verifies glibc runtime compatibility (>= 2.35), configures the appropriate repository (APT or YUM/DNF), and installs the fastest compatible package variant:

```bash
curl -fsSL https://rawvoid.github.io/kvrocks-fpm/install.sh | sudo bash
```

---

### 2. Debian / Ubuntu APT Repository (Manual Setup)

#### Step 1: Add GPG Key and APT Repository
```bash
# 1. Install repository GPG signing key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://rawvoid.github.io/kvrocks-fpm/kvrocks.gpg | sudo tee /etc/apt/keyrings/kvrocks.gpg > /dev/null

# 2. Add repository source entry
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/kvrocks.gpg] https://rawvoid.github.io/kvrocks-fpm stable main" | sudo tee /etc/apt/sources.list.d/kvrocks.list
sudo apt-get update
```

#### Step 2: Install Target Package

* **Standard / Modern x86_64 & ARM64 installation** (Default with AVX2/v3 on x86_64):
  ```bash
  sudo apt-get install -y kvrocks
  ```

* **Legacy installation** (for older x86_64 machines without AVX2):
  ```bash
  sudo apt-get install -y kvrocks-legacy
  ```

---

### 3. Fedora & RPM Systems Repository (Manual Setup)

> [!NOTE]
> **System Requirement**: Pre-built packages are compiled on Ubuntu 22.04 and require **Glibc >= 2.35** and OpenSSL 3. They run out-of-the-box on modern RPM systems such as **Fedora 36+**.
> Enterprise Linux 8 & 9 (RHEL, CentOS Stream, Rocky Linux, AlmaLinux) ship with Glibc 2.28 / 2.34; for EL 8/9 systems, please deploy Kvrocks via Docker/container or compile from source.

#### Step 1: Add RPM Repository Configuration
```bash
sudo curl -fsSL https://rawvoid.github.io/kvrocks-fpm/kvrocks.repo -o /etc/yum.repos.d/kvrocks.repo
```

*(Note: The repository configuration automatically enables `gpgcheck=1` and `repo_gpgcheck=1` using our official public key at `https://rawvoid.github.io/kvrocks-fpm/kvrocks.asc`.)*

#### Step 2: Install Target Package

* **Standard / Modern x86_64 & ARM64 installation** (Default with AVX2/v3 on x86_64):
  ```bash
  sudo dnf install -y kvrocks
  ```

* **Legacy installation** (for older x86_64 machines without AVX2):
  ```bash
  sudo dnf install -y kvrocks-legacy
  ```

*(Note: In RPM packages, `kvrocks` and `kvrocks-legacy` define mutual Conflicts and Provides (without Obsoletes) to allow manual switching between variants while preventing package managers from inadvertently replacing standard builds. Upgrades and flavor switches automatically restart the service if running, and preserve the inactive state if stopped.)*

---

### 4. Manual Package Installation (`.deb` / `.rpm`)

#### Debian / Ubuntu (`.deb`)
```bash
# Install modern performance package (x86_64 default) or arm64
sudo dpkg -i kvrocks_<version>-<iteration>_amd64.deb

# Or install legacy compatibility package (for older CPUs without AVX2)
sudo dpkg -i kvrocks-legacy_<version>-<iteration>_amd64.deb

# Fix missing dependencies if needed
sudo apt-get install -f
```

#### RedHat / Fedora / RPM Systems (`.rpm`)

> **Note**: Packages are built on Ubuntu 22.04 (Glibc 2.35, OpenSSL 3). Target systems must satisfy the highest `GLIBC_` symbol version recorded in each release's `glibc-symbols.txt` asset, and provide OpenSSL 3 runtime (`libssl3` for deb, `libssl.so.3` for rpm).

```bash
# Install modern performance package (x86_64 default)
sudo dnf install ./kvrocks-<version>-<iteration>.x86_64.rpm

# Or install legacy compatibility package
sudo dnf install ./kvrocks-legacy-<version>-<iteration>.x86_64.rpm
```

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
  # Build and publish release (packages + APT repository deployment)
  gh workflow run ci.yaml -f version=2.15.0 -f iteration=1

  # Dry-run / test build only (without creating GitHub release or updating APT repository)
  gh workflow run ci.yaml -f version=2.15.0 -f iteration=1 -f publish_release=false
  ```

---

## 📄 License

This repository and packaging scripts are licensed under the [Apache-2.0 License](LICENSE). Apache Kvrocks is licensed under Apache-2.0.
