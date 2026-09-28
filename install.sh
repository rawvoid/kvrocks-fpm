#!/usr/bin/env bash
#
# Apache Kvrocks Automated Installer for Linux Systems (Debian/Ubuntu/RHEL/CentOS/Rocky/Alma/Fedora)
# Detects CPU capabilities (AVX2/BMI2) and installs the optimal package variant.
#
# Usage:
#   curl -fsSL https://rawvoid.github.io/kvrocks-fpm/install.sh | sudo bash
#

set -euo pipefail

# Visual formatting (disabled if not in a terminal or NO_COLOR is set)
if [ -t 1 ] && [ "${TERM:-dumb}" != "dumb" ] && [ -z "${NO_COLOR:-}" ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' CYAN='' BOLD='' NC=''
fi

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
            *debian*|*ubuntu*) return 0 ;;
        esac
    done
    return 1
}

is_rhel_derivative() {
    case "$OS_ID" in
        rhel|centos|rocky|almalinux|fedora|amzn|ol) return 0 ;;
    esac
    for like in $OS_LIKE; do
        case "$like" in
            *rhel*|*centos*|*fedora*) return 0 ;;
        esac
    done
    return 1
}

main() {
    REPO_URL="${KVROCKS_REPO_URL:-https://kvrocks.kryo.eu.org}"

    # 1. Require root privileges
    if [ "$(id -u)" -ne 0 ]; then
        error "This script must be run as root. Please run: curl -fsSL https://rawvoid.github.io/kvrocks-fpm/install.sh | sudo bash"
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

    OS_FAMILY=""
    if is_debian_derivative; then
        OS_FAMILY="debian"
    elif is_rhel_derivative; then
        OS_FAMILY="rhel"
    else
        warn "Unsupported operating system family: $OS_ID ($OS_LIKE)"
        error "This automated installer supports Debian/Ubuntu and RHEL/CentOS/Rocky/Alma/Fedora systems. For other distributions, please download packages from GitHub Releases."
    fi

    info "Operating System: ${NAME:-Linux} ${VERSION_ID:-} (${OS_FAMILY} family)"

    # Verify runtime glibc compatibility (Kvrocks binary packages require Glibc >= 2.35)
    GLIBC_VER_STR="$(getconf GNU_LIBC_VERSION 2>/dev/null || ldd --version 2>/dev/null | head -n1 || echo "")"
    HOST_GLIBC_VER="$(echo "$GLIBC_VER_STR" | grep -oE '[0-9]+\.[0-9]+' | head -n1 || echo "")"

    if [ -n "$HOST_GLIBC_VER" ]; then
        GLIBC_MAJOR="$(echo "$HOST_GLIBC_VER" | cut -d. -f1)"
        GLIBC_MINOR="$(echo "$HOST_GLIBC_VER" | cut -d. -f2)"
        if [ "$GLIBC_MAJOR" -lt 2 ] || { [ "$GLIBC_MAJOR" -eq 2 ] && [ "$GLIBC_MINOR" -lt 35 ]; }; then
            warn "Detected system GNU C Library (glibc) version: ${HOST_GLIBC_VER}"
            error "Apache Kvrocks binary packages require glibc >= 2.35 (e.g. Fedora 36+, Ubuntu 22.04+, Debian 12+).
Enterprise Linux 8 and 9 (RHEL, CentOS Stream, Rocky Linux, AlmaLinux) provide glibc 2.28-2.34 and cannot run these binaries directly.
For RHEL/Rocky 8 and 9 systems, please deploy Kvrocks via Docker/container or compile from source."
        fi
        info "GNU C Library (glibc) version: ${HOST_GLIBC_VER} (>= 2.35, verified compatible)"
    fi

    # 3. Detect System Architecture & CPU capabilities
    RAW_ARCH="$(uname -m)"
    case "$RAW_ARCH" in
        x86_64|amd64)
            if [ "$OS_FAMILY" = "debian" ]; then
                ARCH="amd64"
            else
                ARCH="x86_64"
            fi
            ;;
        aarch64|arm64)
            if [ "$OS_FAMILY" = "debian" ]; then
                ARCH="arm64"
            else
                ARCH="aarch64"
            fi
            ;;
        *)
            error "Unsupported system architecture: $RAW_ARCH. Kvrocks packages are available for x86_64/amd64 and aarch64/arm64."
            ;;
    esac

    TARGET_PACKAGE="kvrocks"
    CPU_DETAIL="Standard (${ARCH})"

    if [ "$ARCH" = "amd64" ] || [ "$ARCH" = "x86_64" ]; then
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
        FLAVOR="$(echo "$KVROCKS_FLAVOR" | tr '[:upper:]' '[:lower:]')"
        case "$FLAVOR" in
            generic)
                if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
                    TARGET_PACKAGE="kvrocks"
                    CPU_DETAIL="Standard (${ARCH})"
                else
                    TARGET_PACKAGE="kvrocks-legacy"
                    CPU_DETAIL="Forced Legacy (generic) by KVROCKS_FLAVOR"
                fi
                ;;
            legacy|v1)
                if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
                    warn "Legacy flavor is only available for x86_64/amd64 architecture. Using default kvrocks package for ${ARCH}."
                    TARGET_PACKAGE="kvrocks"
                    CPU_DETAIL="Standard (${ARCH})"
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

    if [ "$OS_FAMILY" = "debian" ]; then
        # 4. Configure APT Repository
        REPO_LIST="/etc/apt/sources.list.d/kvrocks.list"
        KEYRING_DIR="/etc/apt/keyrings"
        KEYRING_FILE="${KEYRING_DIR}/kvrocks.gpg"

        info "Configuring APT repository: ${REPO_URL}"
        mkdir -p /etc/apt/sources.list.d
        install -m 0755 -d "$KEYRING_DIR"

        info "Fetching repository GPG signing key..."
        TMP_KEY="$(mktemp)"
        trap 'rm -f "$TMP_KEY"' EXIT

        if command -v curl >/dev/null 2>&1; then
            curl -fsSL "${REPO_URL}/kvrocks.gpg" -o "$TMP_KEY"
        elif command -v wget >/dev/null 2>&1; then
            wget -qO "$TMP_KEY" "${REPO_URL}/kvrocks.gpg"
        else
            error "Neither curl nor wget is available. Please install curl or wget."
        fi

        if [ ! -s "$TMP_KEY" ] || head -c 256 "$TMP_KEY" | grep -qiE '(<html|<!doctype)'; then
            error "Downloaded GPG signing key is invalid, empty, or an HTML error page."
        fi

        install -m 0644 "$TMP_KEY" "$KEYRING_FILE"
        rm -f "$TMP_KEY"
        trap - EXIT

        # Write repository source entry
        cat > "$REPO_LIST" << EOF
# Apache Kvrocks Repository
deb [arch=${ARCH} signed-by=${KEYRING_FILE}] ${REPO_URL} stable main
EOF
        chmod 0644 "$REPO_LIST"

        # 5. Update APT cache and install package
        info "Updating package lists..."
        if ! apt-get update; then
            warn "apt-get update encountered issues (possibly from other repositories). Attempting to proceed..."
        fi

        info "Installing ${TARGET_PACKAGE}..."
        export DEBIAN_FRONTEND=noninteractive
        apt-get install -y "${TARGET_PACKAGE}"

    elif [ "$OS_FAMILY" = "rhel" ]; then
        # 4. Configure RPM (YUM / DNF) Repository
        if command -v dnf >/dev/null 2>&1; then
            PKG_MGR="dnf"
        elif command -v yum >/dev/null 2>&1; then
            PKG_MGR="yum"
        else
            error "Neither dnf nor yum was found on this RPM-based system."
        fi

        REPO_FILE="/etc/yum.repos.d/kvrocks.repo"
        KEY_DIR="/etc/pki/rpm-gpg"
        KEY_FILE="${KEY_DIR}/RPM-GPG-KEY-kvrocks"

        info "Configuring RPM repository from ${REPO_URL}..."
        mkdir -p /etc/yum.repos.d "$KEY_DIR"

        info "Fetching repository GPG signing key..."
        TMP_KEY="$(mktemp)"
        trap 'rm -f "$TMP_KEY"' EXIT

        if command -v curl >/dev/null 2>&1; then
            curl -fsSL "${REPO_URL}/kvrocks.asc" -o "$TMP_KEY"
        elif command -v wget >/dev/null 2>&1; then
            wget -qO "$TMP_KEY" "${REPO_URL}/kvrocks.asc"
        else
            error "Neither curl nor wget is available. Please install curl or wget."
        fi

        if [ ! -s "$TMP_KEY" ] || head -c 256 "$TMP_KEY" | grep -qiE '(<html|<!doctype)'; then
            error "Downloaded GPG signing key is invalid, empty, or an HTML error page."
        fi

        install -m 0644 "$TMP_KEY" "$KEY_FILE"
        rpm --import "$KEY_FILE" 2>/dev/null || true
        rm -f "$TMP_KEY"
        trap - EXIT

        # Write repository configuration dynamically using REPO_URL
        cat > "$REPO_FILE" << EOF
[kvrocks]
name=Apache Kvrocks Repository
baseurl=${REPO_URL}/rpm/\$basearch/
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=${REPO_URL}/kvrocks.asc
EOF
        chmod 0644 "$REPO_FILE"

        # 5. Install package via DNF / YUM
        info "Installing ${TARGET_PACKAGE} via ${PKG_MGR}..."
        "$PKG_MGR" install -y "${TARGET_PACKAGE}"
    fi

    # 6. Installation verification and summary
    if command -v kvrocks >/dev/null 2>&1; then
        if INSTALLED_VER="$(kvrocks --version 2>&1 || kvrocks -v 2>&1)"; then
            success "Kvrocks successfully installed: ${INSTALLED_VER}"
        else
            error "Kvrocks package was installed, but binary failed to execute!
Dynamic linker or runtime dependency error:
${INSTALLED_VER}"
        fi
    else
        error "Package installation command completed, but /usr/bin/kvrocks binary was not found."
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
