# Apache Kvrocks Distro Packages by FPM

Automated packaging pipeline that builds and distributes Debian (`.deb`) and RedHat (`.rpm`) packages for [Apache Kvrocks](https://github.com/apache/kvrocks) using [FPM](https://github.com/jordansissel/fpm) and GitHub Actions.

---

## ✨ Features

- **Multi-Architecture Support**: Native packages for both `x86_64` (`amd64`) and `aarch64` (`arm64`).
- **CPU Microarchitecture Optimization**:
  - **Standard (`generic`)**: Baseline compatibility with all `x86_64` CPUs (`PORTABLE=1`).
  - **Optimized (`avx2`)**: Compiled with `-march=x86-64-v3 -mpclmul -O3` (enabling AVX, AVX2, BMI1/2, FMA, SSE4.2, PCLMUL) for modern servers (~15-30% higher RocksDB throughput).
- **Debian / Ubuntu APT Repository**: Hosted on GitHub Pages with automated index updates and version management.
- **CPU-Aware One-Click Installer**: Automatically detects host CPU instruction sets (AVX2/BMI2) and installs the optimal package.
- **Standard Linux Filesystem Layout**: Conforms to FHS (Filesystem Hierarchy Standard).
- **Systemd Integration & Lifecycle Hooks**: Automatic system user `kvrocks` creation, permission initialization, and `systemd` daemon reload.
- **Enterprise Capabilities**: Built with OpenSSL/TLS (`ENABLE_OPENSSL=ON`), Link-Time Optimization (`ENABLE_LTO=ON`), and Jemalloc memory allocator.
- **Automated Checksums**: Every release includes `SHA256SUMS` for integrity verification.

---

## 📦 Package Variants

| Package Name Pattern | Architecture | Target / CPU | Description |
| :--- | :--- | :--- | :--- |
| `kvrocks_<ver>-<iter>_amd64.deb`<br>`kvrocks-<ver>-<iter>.x86_64.rpm` | `x86_64` | `generic` | Baseline x86-64, maximum compatibility across all machines. |
| `kvrocks-avx2_<ver>-<iter>_amd64.deb`<br>`kvrocks-avx2-<ver>-<iter>.x86_64.rpm` | `x86_64` | `avx2` (x86-64-v3) | Optimized for modern servers (Intel Haswell+, AMD Zen+). |
| `kvrocks_<ver>-<iter>_arm64.deb`<br>`kvrocks-<ver>-<iter>.aarch64.rpm` | `aarch64` | `generic` | 64-bit ARM (AWS Graviton, Aliyun/Tencent ARM, Kunpeng, etc.). |

---

## 🚀 Installation & Usage

### 1. One-Click Automated Install (Debian / Ubuntu)

The installer automatically detects your CPU capabilities (AVX2/BMI2) and architecture, configures the APT repository, and installs the fastest compatible variant:

```bash
curl -fsSL https://rawvoid.github.io/kvrocks-fpm/install.sh | sudo bash
```

---

### 2. Debian / Ubuntu APT Repository (Manual Setup)

#### Step 1: Add the APT Repository
```bash
echo "deb [trusted=yes] https://rawvoid.github.io/kvrocks-fpm stable main" | sudo tee /etc/apt/sources.list.d/kvrocks.list
sudo apt-get update
```

#### Step 2: Install Target Package

* **Standard / ARM64 installation**:
  ```bash
  sudo apt-get install -y kvrocks
  ```

* **Optimized AVX2 installation** (for modern x86_64 servers with AVX2 & BMI2):
  ```bash
  sudo apt-get install -y kvrocks-avx2
  ```

*(Note: `kvrocks` and `kvrocks-avx2` provide mutual conflict and replace rules, allowing seamless switching without orphaned files.)*

---

### 3. Manual Package Installation (`.deb` / `.rpm`)

#### Debian / Ubuntu (`.deb`)
```bash
# Install generic x86_64 or arm64 package
sudo dpkg -i kvrocks_<version>-<iteration>_amd64.deb

# Or install optimized avx2 package (for modern x86_64 servers)
sudo dpkg -i kvrocks-avx2_<version>-<iteration>_amd64.deb

# Fix missing dependencies if needed
sudo apt-get install -f
```

#### RHEL / CentOS / Rocky Linux / Fedora (`.rpm`)
```bash
# Install generic package
sudo dnf install ./kvrocks-<version>-<iteration>.x86_64.rpm

# Or install optimized avx2 package
sudo dnf install ./kvrocks-avx2-<version>-<iteration>.x86_64.rpm
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

# View logs
sudo journalctl -u kvrocks -f
```

Test connection using `redis-cli`:
```bash
redis-cli -p 6666 ping
# PONG
```

---

## 📁 Filesystem Layout

| Path | Purpose |
| :--- | :--- |
| `/usr/bin/kvrocks` | Main Kvrocks server binary |
| `/usr/bin/kvrocks2redis` | Data migration utility to sync Kvrocks to Redis |
| `/etc/kvrocks/kvrocks.conf` | Configuration file (protected during package upgrades) |
| `/usr/lib/systemd/system/kvrocks.service` | Systemd service unit |
| `/var/lib/kvrocks/` | Working & database storage directory (owned by `kvrocks:kvrocks`) |
| `/var/log/kvrocks/` | Server log directory (owned by `kvrocks:kvrocks`) |
| `/usr/share/doc/kvrocks/` | License and Notice documentation |

---

## 🛠️ Build & Release

### 1. Trigger via GitHub Actions Web UI / CLI
You can build and package any Apache Kvrocks version on-demand:

* **GitHub Web UI**: Go to **Actions** -> **Release Packages** -> **Run workflow**, enter `version` (e.g. `2.15.0`) and `iteration` (e.g. `1`).
* **GitHub CLI (`gh`)**:
  ```bash
  # Build and publish release
  gh workflow run ci.yaml -f version=2.15.0 -f iteration=1

  # Test build only (without creating GitHub release)
  gh workflow run ci.yaml -f version=2.15.0 -f iteration=1 -f publish_release=false
  ```

### 2. Trigger via Git Tag
Pushing a version tag automatically triggers the build and creates a GitHub Release:

```bash
git tag v2.15.0-1
git push origin v2.15.0-1
```

---

## 📄 License

This repository and packaging scripts are licensed under the [Apache-2.0 License](LICENSE). Apache Kvrocks is licensed under Apache-2.0.
