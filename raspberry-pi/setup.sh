#!/bin/bash

# Veo Dongle Raspberry Pi - Universal Setup Script
# This script detects the environment and runs the appropriate setup

set -e  # Exit on any error

echo "🚀 Veo Dongle Raspberry Pi - Setup"
echo "==================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect environment
detect_environment() {
    if [[ "$1" == "--wsl" ]] || [[ "$1" == "wsl" ]]; then
        echo "wsl"
    elif [[ "$1" == "--rpi" ]] || [[ "$1" == "rpi" ]] || [[ "$1" == "raspberry" ]]; then
        echo "rpi"
    elif [[ -f /proc/device-tree/model ]] && grep -q "Raspberry Pi" /proc/device-tree/model; then
        echo "rpi"
    elif [[ -f /proc/version ]] && grep -q Microsoft /proc/version; then
        echo "wsl"
    else
        echo "unknown"
    fi
}

# Get environment
ENVIRONMENT=$(detect_environment "$1")

print_status "Detected environment: $ENVIRONMENT"

case $ENVIRONMENT in
    "wsl")
        print_status "Running WSL setup..."
        ./setup-wsl.sh
        ;;
    "rpi")
        print_status "Running Raspberry Pi setup..."
        $SUDO ./setup-rpi.sh
        ;;
    "unknown")
        print_warning "Could not detect environment automatically."
        echo ""
        echo "Please specify your environment:"
        echo "  ./setup.sh --wsl    # For WSL development"
        echo "  ./setup.sh --rpi    # For Raspberry Pi production"
        echo ""
        echo "Or run the specific setup script directly:"
        echo "  ./setup-wsl.sh      # WSL setup"
        echo "  ./setup-rpi.sh      # Raspberry Pi setup"
        exit 1
        ;;
    *)
        print_error "Unknown environment: $ENVIRONMENT"
        exit 1
        ;;
esac

print_success "Setup completed for $ENVIRONMENT environment!"

