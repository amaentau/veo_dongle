#!/usr/bin/env bash
set -euo pipefail

# This script is executed under an X session started by systemd/xinit.
# It simply forwards to the Node.js entry point so that Chromium can be
# launched inside the Xorg context without a full desktop environment.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${HOME}/.Xauthority"
export CHROMIUM_PATH="${CHROMIUM_PATH:-/usr/bin/chromium-browser}"

# Check for mandatory configuration
if [[ ! -f "${APP_ROOT}/config.json" ]] || [[ ! -f "${APP_ROOT}/credentials.json" ]]; then
  echo "[WARNING] Configuration or credentials missing! Forcing provisioning mode."
  export FORCE_PROVISIONING=true
# Check for headless override (Dev Mode)
elif [[ -f "${APP_ROOT}/.headless_ok" ]]; then
  echo "[INFO] .headless_ok marker found. Proceeding in headless mode."
  export FORCE_PROVISIONING=false
else
  # Check for HDMI connection
  check_hdmi() {
    for port in /sys/class/drm/card*-HDMI-A-*/status; do
      if [ -f "$port" ] && grep -q "^connected" "$port"; then
        return 0
      fi
    done
    return 1
  }

  echo "[INFO] Checking for HDMI connection..."
  if ! check_hdmi; then
    echo "[INFO] No HDMI detected. Waiting 10s for TV sync..."
    sleep 10
    if ! check_hdmi; then
      echo "[WARNING] Still no HDMI. Forcing provisioning mode."
      export FORCE_PROVISIONING=true
    else
      echo "[INFO] HDMI detected after sync."
    fi
  else
    echo "[INFO] HDMI connection verified."
  fi
fi

wait_for_connectivity() {
  local target_url="https://www.google.com/generate_204"
  local attempts=0
  local max_attempts=30
  local delay=2

  while (( attempts < max_attempts )); do
    if curl -fsS --head "${target_url}" >/dev/null 2>&1; then
      echo "[INFO] Network connectivity verified"
      return 0
    fi

    attempts=$((attempts + 1))
    echo "[INFO] Waiting for network connectivity (${attempts}/${max_attempts})"
    sleep "${delay}"
    if (( delay < 5 )); then
      delay=$((delay + 1))
    fi
  done

  echo "[WARNING] Network unreachable after ${max_attempts} attempts; proceeding anyway"
  return 0
}

# Skip connectivity check - we now handle this inside Node.js with a splash screen
if [[ ! -f "${APP_ROOT}/config.json" ]] || [[ "${FORCE_PROVISIONING:-false}" == "true" ]]; then
  echo "[INFO] Entering Provisioning Mode."
else
  echo "[INFO] Starting application (Network check deferred to splash screen)."
fi

# Settling delay for system services (especially during cold boot)
sleep 2

cd "${APP_ROOT}"

exec /usr/bin/env node src/index.js

