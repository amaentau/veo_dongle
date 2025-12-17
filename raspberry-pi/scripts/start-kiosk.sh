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

# Check for reboot loop - if 3 reboots in 90s, force provisioning mode
# Do this EARLY, before waiting for network
if ! node "${SCRIPT_DIR}/reboot-check.js"; then
  echo "[WARNING] Reboot loop detected! Forcing provisioning mode."
  export FORCE_PROVISIONING=true
else
  echo "[INFO] Boot check passed."
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
  return 1
}

# Skip connectivity check if config.json is missing (Provisioning Mode)
# OR if FORCE_PROVISIONING is set (Reboot Loop)
if [[ ! -f "${APP_ROOT}/config.json" ]] || [[ "${FORCE_PROVISIONING:-false}" == "true" ]]; then
  echo "[INFO] Entering Provisioning Mode (Config missing or Reboot Loop detected). Skipping connectivity check."
else
  wait_for_connectivity
fi

cd "${APP_ROOT}"

exec /usr/bin/env node src/index.js

