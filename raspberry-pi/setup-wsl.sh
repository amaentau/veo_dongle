#!/bin/bash

# Veo Dongle Raspberry Pi - WSL Setup Script
# This script sets up the development environment in WSL

set -e  # Exit on any error

echo "🚀 Veo Dongle Raspberry Pi - WSL Setup"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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

# Check if we're in WSL
if [[ ! -f /proc/version ]] || ! grep -q Microsoft /proc/version; then
    print_warning "This script is designed for WSL. Running on native Linux."
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 20 or later."
    print_status "You can install Node.js using:"
    print_status "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    print_status "sudo apt-get install -y nodejs"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [[ $NODE_VERSION -lt 20 ]]; then
    print_error "Node.js version 20 or later is required. Current version: $(node --version)"
    exit 1
fi

print_success "Node.js $(node --version) is installed"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm."
    exit 1
fi

print_success "npm $(npm --version) is installed"

# Install project dependencies
print_status "Installing project dependencies..."
npm install

# Fix security vulnerabilities
print_status "Fixing security vulnerabilities..."
npm audit fix

# Install Chromium for WSL
print_status "Installing Chromium browser..."
if command -v apt-get &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y chromium-browser
    print_success "Chromium installed successfully"
elif command -v pacman &> /dev/null; then
    sudo pacman -S chromium
    print_success "Chromium installed successfully"
else
    print_warning "Could not install Chromium automatically. Please install manually:"
    print_warning "Ubuntu/Debian: sudo apt-get install chromium-browser"
    print_warning "Arch Linux: sudo pacman -S chromium"
fi

# Install XVFB for headless testing (optional)
print_status "Installing XVFB for headless operation..."
if command -v apt-get &> /dev/null; then
    sudo apt-get install -y xvfb
    print_success "XVFB installed successfully"
elif command -v pacman &> /dev/null; then
    sudo pacman -S xorg-server-xvfb
    print_success "XVFB installed successfully"
fi

# Create environment file if it doesn't exist
if [[ ! -f .env ]]; then
    print_status "Creating .env file..."
    cat > .env << EOL
# Veo Dongle Raspberry Pi Environment Configuration
# Copy this file and update with your actual values

# Veo Stream Configuration
VEO_STREAM_URL=https://example.com/veo-stream
LOGIN_URL=https://live.veo.co/login
LOGIN_ENABLED=false

# Display Configuration
DISPLAY_WIDTH=1920
DISPLAY_HEIGHT=1080

# Server Configuration
PORT=3000
CLOUD_URL=http://localhost:4000

# Device Configuration
DEVICE_ID=raspberry-pi-wsl-dev

# Azure Table Storage Configuration (recommended for cloud interaction)
AZURE_STORAGE_CONNECTION_STRING=
AZURE_TABLE_NAME=veoDongleStreams
AZURE_STORAGE_ENABLED=false
AZURE_POLL_INTERVAL=30000
AZURE_RETRY_ATTEMPTS=3

# Development Mode
NODE_ENV=development
EOL
    print_success ".env file created. Please edit with your actual values."
else
    print_warning ".env file already exists. Skipping creation."
fi

# Create credentials.json template if it doesn't exist
if [[ ! -f credentials.json ]]; then
    print_status "Creating credentials.json template..."
    cat > credentials.json << EOL
{
  "email": "your-email@example.com",
  "password": "your-password"
}
EOL
    print_warning "credentials.json template created. Update with your actual credentials."
    print_warning "⚠️  IMPORTANT: Add credentials.json to .gitignore to avoid committing sensitive data!"
else
    print_warning "credentials.json already exists. Skipping creation."
fi

# Update config.json with WSL-friendly defaults
if [[ -f config.json ]]; then
    print_status "Updating config.json for WSL..."
    # Create backup
    cp config.json config.json.backup

    # Use Node.js to update config.json
    node -e "
    const config = require('./config.json');
    config.chromium.headless = false;
    config.chromium.args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--start-fullscreen',
      '--kiosk',
      '--disable-web-security'
    ];
    require('fs').writeFileSync('config.json', JSON.stringify(config, null, 2));
    console.log('Config updated for WSL');
    "
    print_success "config.json updated for WSL environment"
fi

# Check if puppeteer can find Chromium
print_status "Verifying Puppeteer installation..."
node -e "
const puppeteer = require('puppeteer');
console.log('Puppeteer version:', puppeteer.version);
console.log('Chromium path:', puppeteer.executablePath());
" || {
    print_warning "Puppeteer verification failed. This might be normal in WSL."
    print_warning "You may need to configure Puppeteer to use system Chromium."
}

# Create a simple test script
print_status "Creating test script..."
cat > test-setup.js << 'EOL'
#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testSetup() {
    console.log('🧪 Testing Puppeteer setup...');

    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();
        await page.goto('https://example.com');
        const title = await page.title();

        console.log('✅ Test successful!');
        console.log('Page title:', title);

        await browser.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('This might be normal if you need additional WSL configuration.');
        process.exit(1);
    }
}

testSetup();
EOL

chmod +x test-setup.js

print_status "Running setup test..."
node test-setup.js || {
    print_warning "Setup test failed, but this might be normal in WSL."
    print_warning "Try running: npm run dev -- https://example.com"
}

# Clean up test file
rm test-setup.js

# Final instructions
echo ""
print_success "WSL setup completed!"
echo ""
print_status "Next steps:"
echo "1. Edit .env file with your actual configuration"
echo "2. Edit credentials.json with your Veo login credentials (if needed)"
echo "3. Run 'npm run dev' to start development mode"
echo "4. Run 'npm start' to run in production mode"
echo ""
print_warning "Make sure to:"
echo "- Add credentials.json to .gitignore"
echo "- Configure DISPLAY environment variable if running GUI applications"
echo "- Install VcXsrv or similar X server for GUI in Windows"
echo ""
print_status "For more information, see the README.md file"
