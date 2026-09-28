#!/usr/bin/env bash
#
# Apache Kvrocks Automated Installer for Debian/Ubuntu Systems
# Detects CPU capabilities (AVX2/BMI2) and installs the optimal package variant.
#
# Usage:
#   curl -fsSL https://rawvoid.github.io/kvrocks-fpm/install.sh | sudo bash
#

set -euo pipefail

# Visual formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info() {
    printf "${BLUE}[INFO]${NC} %s\n" "$1"
}

success() {
    printf "${GREEN}[SUCCESS]${NC} %s\n" "$1"
}

warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$1"
}

error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1" >&2
    exit 1
}

is_debian_derivative() {
    case "$OS_ID" in
        debian|ubuntu|linuxmint|pop|raspbian|kali|elementary|zorin) return 0 ;;
    esac
    for like in $OS_LIKE; do
        case "$like" in
            debian|ubuntu) return 0 ;;
        esac
    done
    return 1
}

main() {
    # 1. Require root privileges
    if [ "$(id -u)" -ne 0 ]; then
        error "This script must be run as root. Please run with sudo: sudo bash $0"
    fi

    printf '%b' "${CYAN}${BOLD}"
    cat << 'EOF'
  _  __                      _        
 | |/ /                     | |       
 | ' / __   ___ __ ___   ___| | _____ 
 |  <  \ \ / / '__/ _ \ / __| |/ / __|
 | . \  \ V / | | | (_) | (__| | <\__ \
 |_|\_\  \_/  |_|  \___/ \___|_|\_\___/
      Apache Kvrocks Automated Installer
EOF
    printf '%b\n' "${NC}"

    # 2. Check OS distribution
    if [ ! -f /etc/os-release ]; then
        error "Cannot determine operating system. /etc/os-release is missing."
    fi

    # shellcheck source=/dev/null
    . /etc/os-release

    OS_ID="${ID:-}"
    OS_LIKE="${ID_LIKE:-}"

    if ! is_debian_derivative; then
        warn "Unsupported operating system family: $OS_ID ($OS_LIKE)"
        error "This automated installer currently supports Debian/Ubuntu derivatives only. For RPM systems, please download from GitHub Releases."
    fi

    info "Operating System: ${NAME:-Linux} ${VERSION_ID:-}"

    # 3. Detect System Architecture & CPU capabilities
    RAW_ARCH="$(uname -m)"
    case "$RAW_ARCH" in
        x86_64|amd64)
            ARCH="amd64"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ;;
        *)
            error "Unsupported system architecture: $RAW_ARCH. Kvrocks packages are available for amd64 and arm64."
            ;;
    esac

    TARGET_PACKAGE="kvrocks"
    CPU_DETAIL="Standard (aarch64)"

    if [ "$ARCH" = "amd64" ]; then
        # Check if host CPU supports x86-64-v3 (AVX2 and BMI2)
        if grep -qw "avx2" /proc/cpuinfo 2>/dev/null && \
           grep -qw "bmi2" /proc/cpuinfo 2>/dev/null; then
            TARGET_PACKAGE="kvrocks"
            CPU_DETAIL="Optimized (x86-64-v3 / AVX2 & BMI2)"
        else
            TARGET_PACKAGE="kvrocks-legacy"
            CPU_DETAIL="Legacy / Compatibility (x86-64-v1, no AVX2/BMI2)"
        fi
    fi

    # Allow environment override: e.g. KVROCKS_FLAVOR=legacy, generic, or default
    if [ -n "${KVROCKS_FLAVOR:-}" ]; then
        case "${KVROCKS_FLAVOR}" in
            generic)
                if [ "$ARCH" = "arm64" ]; then
                    TARGET_PACKAGE="kvrocks"
                    CPU_DETAIL="Standard (aarch64)"
                else
                    TARGET_PACKAGE="kvrocks-legacy"
                    CPU_DETAIL="Forced Legacy (generic) by KVROCKS_FLAVOR"
                fi
                ;;
            legacy|v1)
                if [ "$ARCH" = "arm64" ]; then
                    warn "Legacy flavor is only available for amd64 architecture. Using default kvrocks package for arm64."
                    TARGET_PACKAGE="kvrocks"
                    CPU_DETAIL="Standard (aarch64)"
                else
                    TARGET_PACKAGE="kvrocks-legacy"
                    CPU_DETAIL="Forced Legacy by KVROCKS_FLAVOR"
                fi
                ;;
            default|v3|avx2)
                TARGET_PACKAGE="kvrocks"
                CPU_DETAIL="Forced Default (v3) by KVROCKS_FLAVOR"
                ;;
            *)
                warn "Unrecognized KVROCKS_FLAVOR '${KVROCKS_FLAVOR}'. Using detected target: ${TARGET_PACKAGE}"
                ;;
        esac
    fi

    info "Hardware Architecture: ${ARCH}"
    info "Detected CPU Feature Level: ${CPU_DETAIL}"
    info "Selected Target Package: ${BOLD}${TARGET_PACKAGE}${NC}"

    # 4. Configure APT Repository
    REPO_URL="${KVROCKS_REPO_URL:-https://rawvoid.github.io/kvrocks-fpm}"
    REPO_LIST="/etc/apt/sources.list.d/kvrocks.list"
    KEYRING_DIR="/etc/apt/keyrings"
    KEYRING_FILE="${KEYRING_DIR}/kvrocks.gpg"

    info "Configuring APT repository: ${REPO_URL}"
    mkdir -p /etc/apt/sources.list.d
    install -m 0755 -d "$KEYRING_DIR"

    info "Fetching repository GPG signing key..."
    TMP_KEY="$(mktemp "${KEYRING_DIR}/kvrocks.gpg.XXXXXX")"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "${REPO_URL}/kvrocks.gpg" -o "$TMP_KEY"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$TMP_KEY" "${REPO_URL}/kvrocks.gpg"
    else
        rm -f "$TMP_KEY"
        error "Neither curl nor wget is available. Please install curl or wget."
    fi

    if [ ! -s "$TMP_KEY" ]; then
        rm -f "$TMP_KEY"
        error "Downloaded GPG signing key is empty or corrupted."
    fi

    chmod 0644 "$TMP_KEY"
    mv -f "$TMP_KEY" "$KEYRING_FILE"

    # Write repository source entry
    cat > "$REPO_LIST" << EOF
# Apache Kvrocks Repository
deb [signed-by=${KEYRING_FILE}] ${REPO_URL} stable main
EOF
    chmod 0644 "$REPO_LIST"

    # 5. Update APT cache and install package
    info "Updating package lists..."
    apt-get update

    info "Installing ${TARGET_PACKAGE}..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y "${TARGET_PACKAGE}"

    # 6. Installation verification and summary
    if command -v kvrocks >/dev/null 2>&1; then
        INSTALLED_VER="$(kvrocks -v 2>/dev/null || echo 'installed')"
        success "Kvrocks successfully installed: ${INSTALLED_VER}"
    else
        success "Package installation completed."
    fi

    printf '\n%b%b=== Getting Started with Apache Kvrocks ===%b\n' "${GREEN}" "${BOLD}" "${NC}"
    printf '  • Start service:   %b\n' "${CYAN}sudo systemctl start kvrocks${NC}"
    printf '  • Enable autostart:%b\n' "${CYAN}sudo systemctl enable kvrocks${NC}"
    printf '  • Check status:    %b\n' "${CYAN}sudo systemctl status kvrocks${NC}"
    printf '  • View logs:       %b\n' "${CYAN}sudo journalctl -u kvrocks -f${NC}"
    printf '  • Connect:         %b\n' "${CYAN}redis-cli -p 6666 ping${NC}"
    printf '  • Configuration:   %b\n\n' "${CYAN}/etc/kvrocks/kvrocks.conf${NC}"
}

main "$@"
