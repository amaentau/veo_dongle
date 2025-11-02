#!/bin/bash

# Veo Dongle Raspberry Pi Runner
# This script ensures the correct Node.js version is used

# Load nvm and use Node.js 20
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Use Node.js 20
nvm use 20

# Navigate to the project directory
cd "$(dirname "$0")"

# Check if --dev flag is passed
if [[ "$1" == "--dev" ]]; then
    echo "Starting in development mode with nodemon..."
    npx nodemon src/index.js "${@:2}"
else
    # Run the application with all arguments passed through
    node src/index.js "$@"
fi
