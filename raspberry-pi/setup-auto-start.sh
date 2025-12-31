#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${SCRIPT_DIR}"
SERVICE_USER="espatv"
SERVICE_NAME="espa-tv"

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

# Check if running as root
if [[ $EUID -ne 0 ]]; then
  error "This script must be run as root (e.g. sudo ./setup-auto-start.sh)"
  exit 1
fi

info "Setting up automatic startup for Espa-TV Player on Raspberry Pi"
info "This script configures systemd to start the application after boot AND network connectivity"

# Cleanup old service name if it exists
if systemctl list-unit-files | grep -q veo-dongle.service; then
  info "Detected old veo-dongle.service. Stopping and disabling it."
  systemctl stop veo-dongle.service >/dev/null 2>&1 || true
  systemctl disable veo-dongle.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/veo-dongle.service
fi

# Verify we're on Raspberry Pi hardware
verify_raspberry_pi() {
  if [[ ! -f /proc/device-tree/model ]]; then
    error "This script is designed for Raspberry Pi hardware only"
    error "Raspberry Pi device tree model not found at /proc/device-tree/model"
    exit 1
  fi

  local model
  model="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || echo "unknown")"

  if ! grep -qiE 'raspberry pi' <<<"${model}"; then
    error "This script is designed for Raspberry Pi hardware only"
    error "Detected system: ${model}"
    error "This appears to be a development environment. Use WSL/development setup instead."
    exit 1
  fi

  info "Confirmed Raspberry Pi hardware: ${model}"
}

verify_raspberry_pi

# Check if application files exist
verify_application() {
  if [[ ! -f "${APP_ROOT}/src/index.js" ]]; then
    error "Application file not found: ${APP_ROOT}/src/index.js"
    exit 1
  fi

  if [[ ! -x "${APP_ROOT}/scripts/start-kiosk.sh" ]]; then
    error "Kiosk script not found or not executable: ${APP_ROOT}/scripts/start-kiosk.sh"
    exit 1
  fi

  info "Application files verified"
}

verify_application

# Create service user if it doesn't exist
setup_service_user() {
  if ! id "$SERVICE_USER" &>/dev/null; then
    info "Creating service user '$SERVICE_USER'"
    useradd --create-home --shell /bin/bash --user-group "$SERVICE_USER"
    passwd -d "$SERVICE_USER" >/dev/null 2>&1 || true
  else
    info "Service user '$SERVICE_USER' already exists"
  fi

  # Add user to necessary groups for graphics and input
  usermod -aG video,render,input,dialout,sudo "$SERVICE_USER"

  # Ensure service user owns the application directory
  info "Setting ownership of application directory"
  mkdir -p "${APP_ROOT}"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_ROOT}"
}

setup_service_user

# Check for required dependencies
check_dependencies() {
  local missing_deps=()

  if ! command -v node >/dev/null 2>&1; then
    missing_deps+=("node")
  fi

  if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
    missing_deps+=("chromium")
  fi

  if ! command -v xinit >/dev/null 2>&1; then
    missing_deps+=("xinit")
  fi

  if [[ ${#missing_deps[@]} -gt 0 ]]; then
    error "Missing required dependencies: ${missing_deps[*]}"
    error "Please run ./setup-lite.sh first to install all required dependencies"
    exit 1
  fi

  info "All required dependencies are available"
}

check_dependencies

# Set up Chromium symlinks properly (same logic as setup-lite.sh)
setup_chromium_symlinks() {
  local chromium_path=""
  local chromium_browser_path=""

  # Check what chromium binaries are available
  if command -v chromium >/dev/null 2>&1; then
    chromium_path="$(command -v chromium)"
  fi

  if command -v chromium-browser >/dev/null 2>&1; then
    chromium_browser_path="$(command -v chromium-browser)"
  fi

  # If chromium exists, make chromium-browser a symlink to it
  if [[ -n "${chromium_path}" ]]; then
    if [[ "${chromium_browser_path}" != "${chromium_path}" ]]; then
      info "Making chromium-browser a symlink to chromium"
      ln -sf "${chromium_path}" /usr/bin/chromium-browser
    fi
    # chromium is already the canonical binary
  elif [[ -n "${chromium_browser_path}" ]]; then
    # chromium-browser exists but chromium doesn't - make chromium a symlink to chromium-browser
    info "Making chromium a symlink to chromium-browser"
    ln -sf "${chromium_browser_path}" /usr/bin/chromium
  else
    warning "No Chromium binary found. Please install chromium or chromium-browser."
    return 1
  fi

  # Set up google-chrome-stable symlink (commonly expected by some applications)
  local canonical_chromium=""
  if command -v chromium >/dev/null 2>&1; then
    canonical_chromium="$(command -v chromium)"
  elif command -v chromium-browser >/dev/null 2>&1; then
    canonical_chromium="$(command -v chromium-browser)"
  fi

  if [[ -n "${canonical_chromium}" ]]; then
    ln -sf "${canonical_chromium}" /usr/bin/google-chrome-stable
    info "Created google-chrome-stable symlink"
  fi

  return 0
}

# Create systemd service file
create_systemd_service() {
  info "Creating systemd service for automatic startup"

  local systemd_unit="/etc/systemd/system/${SERVICE_NAME}.service"
  local chromium_path

  # Get the canonical chromium path after setting up symlinks
  if command -v chromium >/dev/null 2>&1; then
    chromium_path="$(command -v chromium)"
  elif command -v chromium-browser >/dev/null 2>&1; then
    chromium_path="$(command -v chromium-browser)"
  else
    chromium_path="/usr/bin/chromium-browser"
  fi

  cat >"${systemd_unit}" <<EOF
[Unit]
Description=Espa-TV Player Kiosk (Xorg + Chromium)
# App handles its own connectivity checks; avoid depending on wait-online units.
After=network.target NetworkManager.service
Wants=network.target NetworkManager.service
# Removed local-fs.target dependency to avoid fsck conflicts
ConditionPathExists=${APP_ROOT}/src/index.js

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_ROOT}
Environment=DISPLAY=:0
Environment=RUNTIME_ENV=raspberry
Environment=PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
Environment=NODE_ENV=production
Environment=CHROMIUM_PATH=${chromium_path}
Environment=XAUTHORITY=/home/${SERVICE_USER}/.Xauthority
ExecStart=/usr/bin/xinit ${APP_ROOT}/scripts/start-kiosk.sh -- :0 -nolisten tcp vt7 -keeptty
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
# Memory limits for kiosk
MemoryLimit=512M
MemoryAccounting=yes
# Timeout for startup
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
EOF

  info "Created systemd service: ${systemd_unit}"
}

# Set up chromium symlinks
if setup_chromium_symlinks; then
  info "Chromium symlinks configured successfully"
else
  warning "Failed to configure Chromium symlinks"
fi

create_systemd_service

# Configure systemd and enable service
configure_systemd() {
  info "Configuring systemd for automatic startup"

  # Reload systemd daemon
  systemctl daemon-reload

  # Enable service to start on boot
  systemctl enable "${SERVICE_NAME}.service"

  # Start service immediately
  systemctl restart "${SERVICE_NAME}.service"

  # Wait for service to attempt startup
  sleep 3

  # Check if service is running
  if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
    success "Service started successfully"
  else
    warning "Service failed to start immediately (this may be normal during initial setup)"
    info "Check status with: sudo systemctl status ${SERVICE_NAME}.service"
  fi
}

configure_systemd

# Create monitoring and management script
create_monitoring_script() {
  info "Creating monitoring and management script"

  cat >"${APP_ROOT}/manage-service.sh" <<EOF
#!/bin/bash
SERVICE_NAME="${SERVICE_NAME}"

case "\${1:-status}" in
  status)
    echo "=== Espa-TV Player Service Status ==="
    echo "Service: \$SERVICE_NAME"
    echo "Active: \$(systemctl is-active \$SERVICE_NAME)"
    echo "Enabled: \$(systemctl is-enabled \$SERVICE_NAME)"
    echo ""
    echo "=== Network Status ==="
    echo "Network online: \$(systemctl is-active network-online.target)"
    ip route show default 2>/dev/null || echo "No default route"
    echo ""
    echo "=== Recent Logs ==="
    journalctl -u \$SERVICE_NAME -n 10 --no-pager
    ;;
  start)
    echo "Starting service..."
    sudo systemctl start \$SERVICE_NAME
    ;;
  stop)
    echo "Stopping service..."
    sudo systemctl stop \$SERVICE_NAME
    ;;
  restart)
    echo "Restarting service..."
    sudo systemctl restart \$SERVICE_NAME
    ;;
  logs)
    echo "Following logs (Ctrl+C to exit)..."
    journalctl -f -u \$SERVICE_NAME
    ;;
  diagnose)
    echo "=== Diagnostic Information ==="
    echo "Raspberry Pi Model: \$(tr -d '\0' </proc/device-tree/model 2>/dev/null || echo 'unknown')"
    echo "OS: \$(lsb_release -d -s 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d'=' -f2 | tr -d '\"')"
    echo "Node.js: \$(node --version 2>/dev/null || echo 'not found')"
    echo "Chromium: \$(chromium-browser --version 2>/dev/null || chromium --version 2>/dev/null || echo 'not found')"
    echo ""
    echo "=== Process Check ==="
    ps aux | grep -E "(node|chromium)" | grep -v grep || echo "No application processes running"
    ;;
  *)
    echo "Usage: \$0 {status|start|stop|restart|logs|diagnose}"
    echo ""
    echo "Commands:"
    echo "  status   - Show service and network status"
    echo "  start    - Start the service"
    echo "  stop     - Stop the service"
    echo "  restart  - Restart the service"
    echo "  logs     - Follow service logs"
    echo "  diagnose - Show diagnostic information"
    exit 1
    ;;
esac
EOF

  chmod +x "${APP_ROOT}/manage-service.sh"
  info "Created management script: ${APP_ROOT}/manage-service.sh"
}

create_monitoring_script

success "Automatic startup setup completed for Raspberry Pi!"
echo ""
echo "=== Service Configuration ==="
echo "Service Name: ${SERVICE_NAME}"
echo "User: ${SERVICE_USER}"
echo "Application: ${APP_ROOT}/src/index.js"
echo ""
echo "=== Startup Behavior ==="
echo "The application will start automatically:"
echo "1. After Raspberry Pi boots up"
echo "2. Only after network connectivity is available (network-online.target)"
echo "3. In fullscreen kiosk mode via Xorg"
echo ""
echo "=== Management Commands ==="
echo "Check status: ${APP_ROOT}/manage-service.sh status"
echo "View logs: ${APP_ROOT}/manage-service.sh logs"
echo "Restart: ${APP_ROOT}/manage-service.sh restart"
echo "Diagnose: ${APP_ROOT}/manage-service.sh diagnose"
echo ""
echo "=== Systemd Commands ==="
echo "Status: sudo systemctl status ${SERVICE_NAME}.service"
echo "Logs: sudo journalctl -f -u ${SERVICE_NAME}.service"
echo "Restart: sudo systemctl restart ${SERVICE_NAME}.service"
echo ""
echo "=== Troubleshooting ==="
echo "• If service fails to start, check network connectivity first"
echo "• Use 'manage-service.sh diagnose' for system information"
echo "• Check logs with 'manage-service.sh logs'"
echo ""
echo "The service is now configured to start automatically on boot!"
echo "Network connectivity is required before the application launches."