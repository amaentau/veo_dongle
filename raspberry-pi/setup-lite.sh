#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${SCRIPT_DIR}"
SERVICE_USER="dongle"
SERVICE_HOME="/home/${SERVICE_USER}"
CONFIG_JSON="${APP_ROOT}/config.json"
DEFAULT_DISPLAY_MODES=("3840x2160" "1920x1080" "1280x720")
DISPLAY_MODES=()
DISPLAY_PREFERRED="auto"
DISPLAY_MODELINE=""
VIRTUAL_WIDTH=3840
VIRTUAL_HEIGHT=2160
DRM_DEVICE=""

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

detect_drm_device() {
  # Skip aggressive device pinning for modesetting unless manually set.
  # The modesetting driver is usually smart enough to find the primary KMS device.
  # Forcing a specific /dev/dri/cardX can fail if the boot order changes.
  if [[ -n "${DRM_DEVICE:-}" ]]; then
     info "Using manually configured DRM device: ${DRM_DEVICE}"
  else
     info "Auto-detecting DRM device by letting Xorg modesetting driver choose."
  fi
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
  git \
  libgbm1 \
  libasound2 \
  matchbox-window-manager \
  xterm \
  network-manager

# Ensure dhcpcd is disabled if we are using NetworkManager to avoid conflicts
if systemctl list-unit-files | grep -q dhcpcd; then
  info "Disabling dhcpcd to avoid conflicts with NetworkManager"
  systemctl disable --now dhcpcd >/dev/null 2>&1 || true
fi

# Allow nmcli without password for the service user (for provisioning)
echo "${SERVICE_USER} ALL=(ALL) NOPASSWD: /usr/bin/nmcli, /usr/bin/systemctl" > "/etc/sudoers.d/010_veo-dongle"
chmod 0440 "/etc/sudoers.d/010_veo-dongle"


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

info "Installing Chromium browser"
if ! apt-get install -y chromium; then
  error "Failed to install Chromium via 'apt-get install chromium'. Please check your APT configuration."
  exit 1
fi

CHROMIUM_BIN="$(command -v chromium || true)"
if [[ -z "${CHROMIUM_BIN}" ]]; then
  error "Chromium binary not found in PATH after installation."
  exit 1
fi

info "Using Chromium binary at ${CHROMIUM_BIN}"

info "Configuring Xorg for modesetting displays"
load_display_config
detect_drm_device

info "Allowing console and service users to start Xorg"
cat >/etc/X11/Xwrapper.config <<'EOF'
allowed_users=anybody
needs_root_rights=yes
EOF

# Create xorg.conf.d directory
mkdir -p /etc/X11/xorg.conf.d

# Remove potential conflicting configurations or previous failed attempts
rm -f /etc/X11/xorg.conf.d/99-veo-modesetting.conf

# Create a robust Xorg config that tries to find the correct DRM device.
# RPi 5 often has card1 as the primary display controller (vc4).

# Try to detect which card is vc4 (usually card1 on Pi 5)
VC4_CARD=""
if [[ -e /dev/dri/card1 ]] && udevadm info -a -n /dev/dri/card1 | grep -q "DRM_NAME=vc4"; then
  VC4_CARD="/dev/dri/card1"
elif [[ -e /dev/dri/card0 ]] && udevadm info -a -n /dev/dri/card0 | grep -q "DRM_NAME=vc4"; then
  VC4_CARD="/dev/dri/card0"
fi

# Fallback: if we can't detect via udev/grep easily, assume card1 if it exists (common for Pi 5), else card0
if [[ -z "${VC4_CARD}" ]]; then
  if [[ -e /dev/dri/card1 ]]; then
     VC4_CARD="/dev/dri/card1"
  else
     VC4_CARD="/dev/dri/card0"
  fi
fi

info "Configuring Xorg to use DRM device: ${VC4_CARD}"

cat >/etc/X11/xorg.conf.d/99-veo-modesetting.conf <<EOF
Section "Device"
    Identifier      "VeoModesetting"
    Driver          "modesetting"
    Option          "Kmsdev" "${VC4_CARD}"
    Option          "AccelMethod" "glamor"
    Option          "DRI" "3"
EndSection

Section "Monitor"
    Identifier      "Monitor0"
    Option          "PreferredMode" "${DISPLAY_PREFERRED}"
EndSection

Section "Screen"
    Identifier      "Screen0"
    Device          "VeoModesetting"
    Monitor         "Monitor0"
    DefaultDepth    24
    SubSection "Display"
        Virtual     ${VIRTUAL_WIDTH} ${VIRTUAL_HEIGHT}
        Modes       ${DISPLAY_MODELINE}
    EndSubSection
EndSection
EOF

info "Determining boot configuration directory (/boot vs /boot/firmware)"
BOOT_DIR="/boot"
if [[ -d "/boot/firmware" ]]; then
  BOOT_DIR="/boot/firmware"
fi
BOOT_CONFIG="${BOOT_DIR}/config.txt"
CMDLINE_FILE="${BOOT_DIR}/cmdline.txt"
info "Using boot directory: ${BOOT_DIR}"

info "Configuring boot options for an HDMI-first kiosk"
{
  grep -q '^hdmi_force_hotplug=1' "${BOOT_CONFIG}" && grep -q '^dtoverlay=vc4-kms-v3d' "${BOOT_CONFIG}"
} || {
  cat >>"${BOOT_CONFIG}" <<'EOF'
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
if ! grep -q "fastboot" "$CMDLINE_FILE"; then
  # Add fastboot and other optimizations to cmdline
  sed -i 's/$/ fastboot quiet loglevel=2/' "$CMDLINE_FILE"
  info "Added fastboot optimizations to cmdline.txt"
fi

# Ensure NetworkManager Wait Online is enabled for robust connectivity
# (assuming NetworkManager is managing the connection, which is standard on modern RPi OS Lite)
if systemctl list-unit-files | grep -q NetworkManager-wait-online.service; then
  info "Enabling NetworkManager-wait-online.service to ensure network is ready before kiosk starts"
  systemctl enable NetworkManager-wait-online.service || true
elif systemctl list-unit-files | grep -q systemd-networkd-wait-online.service; then
  info "Enabling systemd-networkd-wait-online.service"
  systemctl enable systemd-networkd-wait-online.service || true
else
  warning "Could not find a network wait-online service. Network might not be ready immediately at boot."
fi


optimize_boot_services() {
  local services=(
    bluetooth.service
    hciuart.service
    triggerhappy.service
    ModemManager.service
    anacron.service
    cron.service
    apt-daily.service
    apt-daily-upgrade.service
    apt-daily.timer
    apt-daily-upgrade.timer
  )

  info "Disabling unnecessary services/timers to speed kiosk boot"
  for svc in "${services[@]}"; do
    if systemctl list-unit-files "${svc}" >/dev/null 2>&1; then
      info "Masking and stopping ${svc}"
      systemctl disable --now "${svc}" >/dev/null 2>&1 || true
      systemctl mask "${svc}" >/dev/null 2>&1 || true
    fi
  done
  systemctl daemon-reload >/dev/null 2>&1 || true
}

optimize_boot_services

info "Installing npm dependencies with Puppeteer using system Chromium"
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
cd "${APP_ROOT}"
sudo -u "${SERVICE_USER}" env PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install --omit=dev

chmod +x "${APP_ROOT}/scripts/start-kiosk.sh"

info "Creating .xinitrc for ${SERVICE_USER} to launch window manager and kiosk"
cat >"${SERVICE_HOME}/.xinitrc" <<EOF
#!/bin/sh
# Disable DPMS (Display Power Management Signaling) and screen blanking
xset -dpms
xset s off
xset s noblank

# Start the window manager (required for proper fullscreen behavior)
matchbox-window-manager -use_titlebar no &

# Hide cursor when inactive
unclutter -idle 0.1 -root &

# Start the kiosk application
exec ${APP_ROOT}/scripts/start-kiosk.sh
EOF

chown "${SERVICE_USER}:${SERVICE_USER}" "${SERVICE_HOME}/.xinitrc"
chmod +x "${SERVICE_HOME}/.xinitrc"

success "Setup complete! You can launch the kiosk manually via ${APP_ROOT}/scripts/start-kiosk.sh."

info "Installing early-boot reboot monitor service"
MONITOR_SERVICE_FILE="/etc/systemd/system/veo-reboot-monitor.service"

cat >"${MONITOR_SERVICE_FILE}" <<EOF
[Unit]
Description=Veo Reboot Monitor (Early Boot)
DefaultDependencies=no
Before=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
ExecStart=/usr/bin/node ${APP_ROOT}/scripts/reboot-check.js
RemainAfterExit=yes
User=${SERVICE_USER}
Group=${SERVICE_USER}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=sysinit.target
EOF

systemctl enable veo-reboot-monitor.service
success "Early-boot monitor service installed."

info "Installing systemd service for Veo Kiosk"
SERVICE_FILE="/etc/systemd/system/veo-dongle.service"

# Remove old service if it exists
if systemctl is-active --quiet veo-dongle; then
  systemctl stop veo-dongle
fi

cat >"${SERVICE_FILE}" <<EOF
[Unit]
Description=Veo Dongle Kiosk (Xorg)
After=network.target
Wants=network.target

[Service]
User=${SERVICE_USER}
Group=${SERVICE_USER}
Environment="DISPLAY=:0"
# Start Xorg directly; .xinitrc will handle the rest (window manager + app)
ExecStart=/usr/bin/startx
WorkingDirectory=${SERVICE_HOME}
Restart=always
RestartSec=5
# Ensure logs are captured
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload
# Enable the service so it starts on boot
systemctl enable veo-dongle.service

success "Systemd service installed and enabled."
info "To start the service now: sudo systemctl start veo-dongle"
info "To stop the service: sudo systemctl stop veo-dongle"
info "To view logs: journalctl -u veo-dongle -f"


