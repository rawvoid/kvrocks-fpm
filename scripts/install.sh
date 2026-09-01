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

# 1. Require root privileges
if [ "$(id -u)" -ne 0 ]; then
    error "This script must be run as root. Please run with sudo: sudo bash $0"
fi

printf "${CYAN}${BOLD}"
cat << 'EOF'
   __  __                             _         
  |  \/  |                           | |        
  | \  / | _____   ___ __ ___   ____ | | _____  
  | |\/| |/ _ \ \ / / '__/ _ \ / ___|| |/ / __| 
  | |  | |  __/\ V /| | | (_) | |___ |   <\__ \ 
  |_|  |_|\___| \_/ |_|  \___/ \____||_|\_\___/ 
      Apache Kvrocks Automated Installer
EOF
printf "${NC}\n"

# 2. Check OS distribution
if [ ! -f /etc/os-release ]; then
    error "Cannot determine operating system. /etc/os-release is missing."
fi

. /etc/os-release

OS_ID="${ID:-}"
OS_LIKE="${ID_LIKE:-}"

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
CPU_DETAIL="Generic / Baseline"

if [ "$ARCH" = "amd64" ]; then
    # Detect AVX2 and BMI2 support from /proc/cpuinfo
    if grep -qE "(^|\s)avx2(\s|$)" /proc/cpuinfo 2>/dev/null && \
       grep -qE "(^|\s)bmi2(\s|$)" /proc/cpuinfo 2>/dev/null; then
        TARGET_PACKAGE="kvrocks-avx2"
        CPU_DETAIL="Optimized (AVX2, BMI2, x86-64-v3)"
    fi
fi

# Allow environment override: e.g. KVROCKS_FLAVOR=generic or KVROCKS_FLAVOR=avx2
if [ -n "${KVROCKS_FLAVOR:-}" ]; then
    if [ "${KVROCKS_FLAVOR}" = "generic" ]; then
        TARGET_PACKAGE="kvrocks"
        CPU_DETAIL="Forced Generic by KVROCKS_FLAVOR"
    elif [ "${KVROCKS_FLAVOR}" = "avx2" ]; then
        TARGET_PACKAGE="kvrocks-avx2"
        CPU_DETAIL="Forced AVX2 by KVROCKS_FLAVOR"
    fi
fi

info "Hardware Architecture: ${ARCH}"
info "Detected CPU Feature Level: ${CPU_DETAIL}"
info "Selected Target Package: ${BOLD}${TARGET_PACKAGE}${NC}"

# 4. Configure APT Repository
REPO_URL="${KVROCKS_REPO_URL:-https://rawvoid.github.io/kvrocks-fpm}"
REPO_LIST="/etc/apt/sources.list.d/kvrocks.list"

info "Configuring APT repository: ${REPO_URL}"
mkdir -p /etc/apt/sources.list.d

# Write repository source entry
cat > "$REPO_LIST" << EOF
# Apache Kvrocks Repository
deb [trusted=yes] ${REPO_URL} stable main
EOF

# 5. Update APT cache and install package
info "Updating package lists..."
apt-get update -o Dir::Etc::sourcelist="sources.list.d/kvrocks.list" \
               -o Dir::Etc::sourceparts="-" \
               -o APT::Get::List-Cleanup="0" \
               -qq || apt-get update -qq

info "Installing ${TARGET_PACKAGE}..."
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --allow-unauthenticated "${TARGET_PACKAGE}"

# 6. Installation verification and summary
if command -v kvrocks >/dev/null 2>&1; then
    INSTALLED_VER="$(kvrocks -v 2>/dev/null || echo 'installed')"
    success "Kvrocks successfully installed: ${INSTALLED_VER}"
else
    success "Package installation completed."
fi

printf "\n${GREEN}${BOLD}=== Getting Started with Apache Kvrocks ===${NC}\n"
printf "  • Start service:   ${CYAN}sudo systemctl start kvrocks${NC}\n"
printf "  • Enable autostart:${CYAN}sudo systemctl enable kvrocks${NC}\n"
printf "  • Check status:    ${CYAN}sudo systemctl status kvrocks${NC}\n"
printf "  • View logs:       ${CYAN}sudo journalctl -u kvrocks -f${NC}\n"
printf "  • Connect:         ${CYAN}redis-cli -p 6666 ping${NC}\n"
printf "  • Configuration:   ${CYAN}/etc/kvrocks/kvrocks.conf${NC}\n\n"
