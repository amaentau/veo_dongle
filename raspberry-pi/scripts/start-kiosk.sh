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

cd "${APP_ROOT}"

exec /usr/bin/env node src/index.js

