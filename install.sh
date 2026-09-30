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
    RED=$'\033[0;31m'
    GREEN=$'\033[0;32m'
    YELLOW=$'\033[1;33m'
    BLUE=$'\033[0;34m'
    CYAN=$'\033[0;36m'
    BOLD=$'\033[1m'
    NC=$'\033[0m'
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

fetch_file() {
    local url="$1"
    local dest="$2"
    local mode="${3:-0644}"

    local tmp_file
    tmp_file="$(mktemp)"
    trap 'rm -f "$tmp_file"' EXIT

    if command -v curl >/dev/null 2>&1; then
        if ! curl -fsSL "$url" -o "$tmp_file"; then
            error "Failed to download $url using curl."
        fi
    elif command -v wget >/dev/null 2>&1; then
        if ! wget -qO "$tmp_file" "$url"; then
            error "Failed to download $url using wget."
        fi
    else
        error "Neither curl nor wget is available. Please install curl or wget."
    fi

    if [ ! -s "$tmp_file" ] || head -c 256 "$tmp_file" | grep -qiE '(<html|<!doctype)'; then
        error "Downloaded file from $url is invalid, empty, or an HTML error page."
    fi

    install -m "$mode" "$tmp_file" "$dest"
    rm -f "$tmp_file"
    trap - EXIT
}

fetch_text() {
    local url="$1"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" 2>/dev/null || true
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- "$url" 2>/dev/null || true
    else
        error "Neither curl nor wget is available. Please install curl or wget."
    fi
}

resolve_repo_url() {
    # 1. Allow explicit environment variable override
    if [ -n "${KVROCKS_REPO_URL:-}" ]; then
        echo "${KVROCKS_REPO_URL%/}"
        return 0
    fi

    # 2. Dynamically resolve from authoritative kvrocks.repo
    local repo_cfg_url="https://rawvoid.github.io/kvrocks-fpm/kvrocks.repo"
    local content
    content="$(fetch_text "$repo_cfg_url")"

    local resolved_url
    resolved_url="$(echo "$content" | grep -m1 '^baseurl=' | sed -E 's|^baseurl=(https?://[^/]+).*|\1|' || true)"

    # 3. Explicit error if resolution failed (strictly no hardcoded fallback)
    if [ -z "$resolved_url" ]; then
        error "Failed to resolve repository URL from ${repo_cfg_url}. Please check your network connection or specify KVROCKS_REPO_URL."
    fi

    echo "${resolved_url%/}"
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
    REPO_URL="$(resolve_repo_url)"
    CHANNEL="${KVROCKS_CHANNEL:-stable}"
    if [ "$CHANNEL" != "stable" ] && [ "$CHANNEL" != "testing" ]; then
        error "Unsupported KVROCKS_CHANNEL '${CHANNEL}'. Must be 'stable' or 'testing'."
    fi

    # 1. Require root privileges
    if [ "$(id -u)" -ne 0 ]; then
        error "This script must be run as root."
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
    if [ -f /etc/os-release ]; then
        # shellcheck source=/dev/null
        . /etc/os-release
    elif [ -f /usr/lib/os-release ]; then
        # shellcheck source=/dev/null
        . /usr/lib/os-release
    else
        error "Cannot determine operating system. Neither /etc/os-release nor /usr/lib/os-release was found."
    fi

    OS_ID="$(echo "${ID:-}" | tr '[:upper:]' '[:lower:]')"
    OS_LIKE="$(echo "${ID_LIKE:-}" | tr '[:upper:]' '[:lower:]')"

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
        case "$(echo "$KVROCKS_FLAVOR" | tr '[:upper:]' '[:lower:]')" in
            legacy|v1|generic)
                if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
                    warn "Legacy flavor is only available for x86_64/amd64 architecture. Using default kvrocks package for ${ARCH}."
                else
                    TARGET_PACKAGE="kvrocks-legacy"
                    CPU_DETAIL="Forced Legacy by KVROCKS_FLAVOR"
                fi
                ;;
            default|v3|avx2)
                TARGET_PACKAGE="kvrocks"
                if [ "$ARCH" = "amd64" ] || [ "$ARCH" = "x86_64" ]; then
                    CPU_DETAIL="Forced Default by KVROCKS_FLAVOR"
                fi
                ;;
            *)
                warn "Unrecognized KVROCKS_FLAVOR '${KVROCKS_FLAVOR}'. Using detected target: ${TARGET_PACKAGE}"
                ;;
        esac
    fi

    info "Hardware Architecture: ${ARCH}"
    info "Detected CPU Feature Level: ${CPU_DETAIL}"
    info "Selected Target Package: ${BOLD}${TARGET_PACKAGE}${NC}"
    info "Distribution Channel: ${BOLD}${CHANNEL}${NC}"

    if [ "$OS_FAMILY" = "debian" ]; then
        # 4. Configure APT Repository
        REPO_LIST="/etc/apt/sources.list.d/kvrocks.list"
        KEYRING_DIR="/etc/apt/keyrings"
        KEYRING_FILE="${KEYRING_DIR}/kvrocks.gpg"

        info "Configuring APT repository: ${REPO_URL} (${CHANNEL})"
        mkdir -p /etc/apt/sources.list.d
        install -m 0755 -d "$KEYRING_DIR"

        info "Fetching repository GPG signing key..."
        fetch_file "${REPO_URL}/kvrocks.gpg" "$KEYRING_FILE" 0644

        # Write repository source entry
        cat > "$REPO_LIST" << EOF
# Apache Kvrocks Repository (${CHANNEL})
deb [arch=${ARCH} signed-by=${KEYRING_FILE}] ${REPO_URL} ${CHANNEL} main
EOF
        chmod 0644 "$REPO_LIST"

        # 5. Update APT cache and install package
        info "Updating package lists..."
        if ! apt-get update; then
            warn "apt-get update encountered issues (possibly from other repositories). Attempting to proceed..."
        fi

        info "Installing ${TARGET_PACKAGE}..."
        export DEBIAN_FRONTEND=noninteractive
        apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" "${TARGET_PACKAGE}"

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
        fetch_file "${REPO_URL}/kvrocks.asc" "$KEY_FILE" 0644
        rpm --import "$KEY_FILE" 2>/dev/null || true

        # Write repository configuration dynamically using REPO_URL
        cat > "$REPO_FILE" << EOF
[kvrocks]
name=Apache Kvrocks Repository
baseurl=${REPO_URL}/rpm/stable/\$basearch/
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file://${KEY_FILE}
       ${REPO_URL}/kvrocks.asc

[kvrocks-testing]
name=Apache Kvrocks Testing Repository
baseurl=${REPO_URL}/rpm/testing/\$basearch/
enabled=0
gpgcheck=1
repo_gpgcheck=1
gpgkey=file://${KEY_FILE}
       ${REPO_URL}/kvrocks.asc
EOF
        chmod 0644 "$REPO_FILE"

        # 5. Install package via DNF / YUM
        RPM_EXTRA_OPTS=()
        if [ "$CHANNEL" = "testing" ]; then
            info "Enabling kvrocks-testing repository channel..."
            RPM_EXTRA_OPTS+=(--enablerepo=kvrocks-testing)
        fi

        info "Installing ${TARGET_PACKAGE} via ${PKG_MGR} (${CHANNEL})..."
        if [ "$PKG_MGR" = "dnf" ]; then
            "$PKG_MGR" install -y --refresh --allowerasing "${RPM_EXTRA_OPTS[@]}" "${TARGET_PACKAGE}"
        else
            "$PKG_MGR" makecache || true
            "$PKG_MGR" install -y "${RPM_EXTRA_OPTS[@]}" "${TARGET_PACKAGE}"
        fi
    fi

    # 6. Installation verification and summary
    KVROCKS_BIN=""
    if [ -x /usr/bin/kvrocks ]; then
        KVROCKS_BIN="/usr/bin/kvrocks"
    elif command -v kvrocks >/dev/null 2>&1; then
        KVROCKS_BIN="$(command -v kvrocks)"
    fi

    if [ -n "$KVROCKS_BIN" ]; then
        if INSTALLED_VER="$("$KVROCKS_BIN" --version 2>&1)" || INSTALLED_VER="$("$KVROCKS_BIN" -v 2>&1)"; then
            success "Kvrocks successfully installed: ${INSTALLED_VER}"
        else
            error "Kvrocks package was installed, but binary failed to execute!
Dynamic linker or runtime dependency error:
${INSTALLED_VER}"
        fi
    else
        error "Package installation command completed, but kvrocks binary was not found in /usr/bin/ or PATH."
    fi

    printf '\n%b%b=== Getting Started with Apache Kvrocks ===%b\n' "${GREEN}" "${BOLD}" "${NC}"
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
        printf '  • Start service:   %b\n' "${CYAN}sudo systemctl start kvrocks${NC}"
        printf '  • Enable autostart:%b\n' "${CYAN}sudo systemctl enable kvrocks${NC}"
        printf '  • Check status:    %b\n' "${CYAN}sudo systemctl status kvrocks${NC}"
        printf '  • View logs:       %b\n' "${CYAN}sudo journalctl -u kvrocks -f${NC}"
    else
        printf '  • Start service:   %b\n' "${CYAN}kvrocks -c /etc/kvrocks/kvrocks.conf${NC}"
        printf '  • View logs:       %b\n' "${CYAN}tail -f /var/log/kvrocks/kvrocks_*.log${NC}"
    fi
    printf '  • Connect:         %b\n' "${CYAN}redis-cli -p 6666 ping${NC}"
    printf '  • Configuration:   %b\n\n' "${CYAN}/etc/kvrocks/kvrocks.conf${NC}"
}

main "$@"
