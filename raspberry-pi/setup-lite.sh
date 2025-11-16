#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${SCRIPT_DIR}"
SERVICE_USER="dongle"
SERVICE_HOME="/home/${SERVICE_USER}"
SERVICE_NAME="veo-dongle-kiosk"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
CONFIG_JSON="${APP_ROOT}/config.json"
DEFAULT_DISPLAY_MODES=("3840x2160" "1920x1080" "1280x720")
DISPLAY_MODES=()
DISPLAY_PREFERRED="auto"
DISPLAY_MODELINE=""
VIRTUAL_WIDTH=3840
VIRTUAL_HEIGHT=2160

info() {
  echo -e "\e[1;34m[INFO]\e[0m $*"
}

success() {
  echo -e "\e[1;32m[SUCCESS]\e[0m $*"
}

warning() {
  echo -e "\e[1;33m[WARNING]\e[0m $*"
}

error() {
  echo -e "\e[1;31m[ERROR]\e[0m $*"
}

ensure_raspberry_pi() {
  if [[ -f /proc/device-tree/model ]]; then
    local detectedModel
    detectedModel="$(tr -d '\0' </proc/device-tree/model)"
    if grep -qiE 'raspberry pi (4|5)' <<<"${detectedModel}"; then
      info "Detected Raspberry Pi model: ${detectedModel}"
    else
      warning "Expected Raspberry Pi 4/5 but detected '${detectedModel}'. The kiosk path still works with newer Pi models; proceed with caution."
    fi
  else
    warning "Raspberry Pi model could not be read from /proc/device-tree/model"
  fi
}

load_display_config() {
  DISPLAY_MODES=("${DEFAULT_DISPLAY_MODES[@]}")
  DISPLAY_PREFERRED="auto"

  if [[ -f "${CONFIG_JSON}" ]]; then
    if command -v jq >/dev/null 2>&1; then
      # Try to parse with jq
      if mapfile -t parsedModes < <(jq -r '.display.modes[]? | select(length > 0)' "${CONFIG_JSON}" 2>/dev/null); then
        if [[ ${#parsedModes[@]} -gt 0 ]]; then
          DISPLAY_MODES=("${parsedModes[@]}")
        fi
      fi

      local pref
      if pref="$(jq -r '.display.preferredMode // empty' "${CONFIG_JSON}" 2>/dev/null)" && [[ -n "${pref}" ]]; then
        DISPLAY_PREFERRED="${pref}"
      fi
    else
      warning "jq not available, unable to parse display settings from ${CONFIG_JSON}; using defaults"
    fi
  else
    warning "Config file ${CONFIG_JSON} not found; using default display settings"
  fi

  local highestW=0
  local highestH=0

  for mode in "${DISPLAY_MODES[@]}"; do
    if [[ "${mode}" =~ ^([0-9]+)x([0-9]+)$ ]]; then
      local modeW=${BASH_REMATCH[1]}
      local modeH=${BASH_REMATCH[2]}
      (( modeW > highestW )) && highestW=${modeW}
      (( modeH > highestH )) && highestH=${modeH}
    fi
  done

  if (( highestW > 0 )); then
    VIRTUAL_WIDTH=${highestW}
  else
    VIRTUAL_WIDTH=3840
  fi

  if (( highestH > 0 )); then
    VIRTUAL_HEIGHT=${highestH}
  else
    VIRTUAL_HEIGHT=2160
  fi

  DISPLAY_MODELINE=""
  for mode in "${DISPLAY_MODES[@]}"; do
    DISPLAY_MODELINE+="\"${mode}\" "
  done
  DISPLAY_MODELINE=${DISPLAY_MODELINE%" "}
  if [[ -z "${DISPLAY_MODELINE}" ]]; then
    DISPLAY_MODELINE="\"3840x2160\" \"1920x1080\" \"1280x720\""
  fi

  info "Display config: modes=${DISPLAY_MODES[*]} preferred=${DISPLAY_PREFERRED} virtual=${VIRTUAL_WIDTH}x${VIRTUAL_HEIGHT}"
}

if [[ $EUID -ne 0 ]]; then
  error "This script must be run as root (e.g. sudo ./setup-lite.sh)"
  exit 1
fi

ensure_raspberry_pi

info "Setting up Veo Dongle on Raspberry Pi Lite (Xorg + fullscreen kiosk)"

if ! id "$SERVICE_USER" &>/dev/null; then
  info "Creating dedicated user '${SERVICE_USER}'"
  useradd --create-home --shell /bin/bash --user-group "$SERVICE_USER"
  passwd -d "$SERVICE_USER" >/dev/null 2>&1 || true
else
  info "User '${SERVICE_USER}' already exists"
fi

usermod -aG video,render,input,dialout,sudo "$SERVICE_USER"

info "Ensuring ${SERVICE_USER} owns the project directory"
mkdir -p "${SERVICE_HOME}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_ROOT}"

info "Updating base system packages"
apt-get update
apt-get upgrade -y

info "Installing prerequisite packages"
apt-get install -y \
  curl \
  ca-certificates \
  gnupg \
  lsb-release \
  xserver-xorg \
  xinit \
  x11-xserver-utils \
  xserver-xorg-video-all \
  x11-apps \
  dbus-x11 \
  unclutter \
  mesa-utils \
  python3 \
  unzip \
  git

# Install jq separately as it may not be in default repos
info "Installing jq for JSON parsing"
if ! command -v jq >/dev/null 2>&1; then
  # First try to add backports if we're on Debian/Raspbian
  if grep -q "Raspbian\|Debian" /etc/os-release 2>/dev/null; then
    # Enable backports for Bullseye/Bookworm
    if grep -q "bullseye\|bookworm" /etc/os-release; then
      echo "deb http://deb.debian.org/debian $(lsb_release -cs)-backports main" > /etc/apt/sources.list.d/backports.list
      apt-get update
    fi
  fi

  if apt-get install -y jq 2>/dev/null; then
    info "jq installed successfully"
  else
    warning "jq not available in repos, downloading static binary"
    # Download static ARM64 binary from a reliable source
    if [[ "$(uname -m)" == "aarch64" ]]; then
      # Use the official jq static binary for ARM64
      curl -L -o /tmp/jq https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-arm64 && \
      chmod +x /tmp/jq && \
      mv /tmp/jq /usr/local/bin/jq && \
      info "jq installed manually (ARM64)"
    elif [[ "$(uname -m)" == "armv7l" ]]; then
      # For 32-bit ARM
      curl -L -o /tmp/jq https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-armhf && \
      chmod +x /tmp/jq && \
      mv /tmp/jq /usr/local/bin/jq && \
      info "jq installed manually (ARM 32-bit)"
    else
      warning "Unsupported architecture $(uname -m) for jq installation. Display config will use defaults."
    fi
  fi
fi

info "Bootstrapping Node.js 20 (Nodesource)"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

info "Installing Chromium from Raspberry Pi OS repositories"
if apt-cache show chromium >/dev/null 2>&1; then
  apt-get install -y chromium
elif apt-cache show chromium-browser >/dev/null 2>&1; then
  apt-get install -y chromium-browser
else
  warning "Chromium package not found in apt cache; install manually if needed."
fi

info "Installing Chromium runtime dependencies"
apt-get install -y \
  libnss3 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  libxkbcommon0 \
  libasound2 \
  libappindicator3-1 \
  fontconfig \
  fonts-liberation \
  fonts-dejavu-core \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libsystemd0 \
  libstdc++6

CHROMIUM_CANDIDATE="$(command -v chromium-browser || command -v chromium || true)"
if [[ -z "${CHROMIUM_CANDIDATE}" ]]; then
  warning "Could not locate a Chromium executable; please ensure Chromium is installed."
else
  ln -sf "${CHROMIUM_CANDIDATE}" /usr/bin/chromium-browser
  ln -sf "${CHROMIUM_CANDIDATE}" /usr/bin/chromium
  ln -sf "${CHROMIUM_CANDIDATE}" /usr/bin/google-chrome-stable
fi

info "Configuring Xorg for modesetting displays"
load_display_config
mkdir -p /etc/X11/xorg.conf.d
cat >/etc/X11/xorg.conf.d/99-veo-modesetting.conf <<'EOF'
Section "Device"
  Identifier "VeoModesetting"
  Driver "modesetting"
  Option "AccelMethod" "glamor"
  Option "DRI" "3"
  Option "TearFree" "true"
EndSection

Section "Monitor"
  Identifier "Monitor0"
  Option "PreferredMode" "${DISPLAY_PREFERRED}"
EndSection

Section "Screen"
  Identifier "Screen0"
  Device "VeoModesetting"
  Monitor "Monitor0"
  DefaultDepth 24
  SubSection "Display"
    Virtual ${VIRTUAL_WIDTH} ${VIRTUAL_HEIGHT}
    Modes ${DISPLAY_MODELINE}
  EndSubSection
EndSection
EOF

info "Configuring boot options for an HDMI-first kiosk"
{
  grep -q '^hdmi_force_hotplug=1' /boot/config.txt && grep -q '^dtoverlay=vc4-kms-v3d' /boot/config.txt
} || {
  cat >>/boot/config.txt <<'EOF'
hdmi_force_hotplug=1
hdmi_group=1
# Leave hdmi_mode unset so the display can negotiate the native resolution.
disable_overscan=1
dtoverlay=vc4-kms-v3d
gpu_mem=256

# Boot optimizations for kiosk
boot_delay=0
initial_turbo=30
disable_splash=1
EOF
}

info "Optimizing cmdline.txt for faster boot"
CMDLINE_FILE="/boot/cmdline.txt"
if ! grep -q "fastboot" "$CMDLINE_FILE"; then
  # Add fastboot and other optimizations to cmdline
  sed -i 's/$/ fastboot quiet loglevel=2/' "$CMDLINE_FILE"
  info "Added fastboot optimizations to cmdline.txt"
fi

optimize_boot_services() {
  info "Disabling unnecessary services for kiosk mode"

  # Services to disable for faster boot and reduced resource usage
  local services_to_disable=(
    "bluetooth.service"
    "avahi-daemon.service"
    "triggerhappy.service"
    "raspi-config.service"
    "keyboard-setup.service"
    "dphys-swapfile.service"
    "plymouth-start.service"
    "plymouth-read-write.service"
    "plymouth-quit.service"
    "plymouth-quit-wait.service"
    "systemd-ask-password-console.service"
    "systemd-ask-password-wall.service"
  )

  for service in "${services_to_disable[@]}"; do
    if systemctl is-enabled "$service" >/dev/null 2>&1; then
      systemctl disable "$service" 2>/dev/null || true
      info "Disabled $service"
    fi
  done

  # Stop services that are running
  for service in "${services_to_disable[@]}"; do
    if systemctl is-active "$service" >/dev/null 2>&1; then
      systemctl stop "$service" 2>/dev/null || true
    fi
  done

  # Configure systemd journal for smaller size (kiosk doesn't need much history)
  mkdir -p /etc/systemd/journald.conf.d
  cat >/etc/systemd/journald.conf.d/01-kiosk.conf <<'EOF'
[Journal]
Storage=volatile
RuntimeMaxUse=32M
RuntimeMaxFileSize=8M
EOF

  # Configure systemd to skip fsck on boot for faster startup
  systemctl mask systemd-fsck-root.service 2>/dev/null || true
  systemctl mask systemd-fsck@.service 2>/dev/null || true

  # Disable unnecessary kernel modules for faster boot
  cat >/etc/modprobe.d/kiosk-blacklist.conf <<'EOF'
# Disable unused kernel modules for kiosk
blacklist snd_bcm2835
blacklist vc_sm_cma
blacklist bcm2835_v4l2
blacklist bcm2835_codec
blacklist bcm2835_isp
blacklist bcm2835_mmal_vchiq
blacklist bcm2835_unicam
blacklist i2c_bcm2835
blacklist spi_bcm2835
blacklist i2c_dev
blacklist spidev
EOF

  # Configure systemd for faster startup
  mkdir -p /etc/systemd/system.conf.d
  cat >/etc/systemd/system.conf.d/kiosk.conf <<'EOF'
[Manager]
# Reduce timeout for service startup
DefaultTimeoutStartSec=10s
DefaultTimeoutStopSec=10s
# Reduce logging for faster boot
LogLevel=warning
EOF

  info "Boot services optimized for kiosk mode"
}

optimize_boot_services

info "Installing npm dependencies with Puppeteer using system Chromium"
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
cd "${APP_ROOT}"
sudo -u "${SERVICE_USER}" env PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install --omit=dev

chmod +x "${APP_ROOT}/scripts/start-kiosk.sh"

info "Creating systemd unit ${SYSTEMD_UNIT}"
cat >"${SYSTEMD_UNIT}" <<EOF
[Unit]
Description=Veo Dongle Kiosk (Xorg + Chromium)
After=network-online.target local-fs.target
Wants=network-online.target
Requires=local-fs.target

[Service]
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_ROOT}
Environment=DISPLAY=:0
Environment=RUNTIME_ENV=raspberry
Environment=PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
Environment=NODE_ENV=production
Environment=CHROMIUM_PATH=${CHROMIUM_CANDIDATE:-/usr/bin/chromium-browser}
Environment=XAUTHORITY=${SERVICE_HOME}/.Xauthority
ExecStart=/usr/bin/xinit ${APP_ROOT}/scripts/start-kiosk.sh -- :0 -nolisten tcp vt7 -keeptty
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
# Reduce memory usage for kiosk
MemoryLimit=512M
MemoryAccounting=yes

[Install]
WantedBy=multi-user.target
EOF

info "Reloading systemd and enabling kiosk service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"

success "Setup complete! The kiosk service is running as ${SERVICE_USER}."
success "Logs: sudo journalctl -f -u ${SERVICE_NAME}.service"

