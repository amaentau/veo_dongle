#!/bin/bash

# Veo Dongle Raspberry Pi - Production Setup Script
# This script sets up the production environment on Raspberry Pi

set -e  # Exit on any error

echo "🚀 Veo Dongle Raspberry Pi - Production Setup"
echo "=============================================="

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

# Check if we're running on Raspberry Pi
if [[ ! -f /proc/device-tree/model ]] || ! grep -q "Raspberry Pi" /proc/device-tree/model; then
    print_warning "This script is designed for Raspberry Pi. Current system:"
    cat /proc/device-tree/model 2>/dev/null || echo "Unknown system"
fi

# Check if running as root (required for system installations)
if [[ $EUID -eq 0 ]]; then
    print_warning "Running as root. Some operations may require sudo."
    SUDO=""
else
    print_status "Running as regular user. Using sudo for system operations."
    SUDO="sudo"
fi

# Update system packages
print_status "Updating system packages..."
$SUDO apt-get update && $SUDO apt-get upgrade -y

# Install Node.js 20 LTS
print_status "Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
    $SUDO apt-get install -y nodejs
    print_success "Node.js installed successfully"
else
    print_success "Node.js $(node --version) is already installed"
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [[ $NODE_VERSION -lt 20 ]]; then
    print_error "Node.js version 20 or later is required. Current version: $(node --version)"
    exit 1
fi

# Install Chromium browser
print_status "Installing Chromium browser..."
if ! command -v chromium-browser &> /dev/null; then
    $SUDO apt-get install -y chromium-browser
    print_success "Chromium installed successfully"
else
    print_success "Chromium is already installed"
fi

# Install additional dependencies for Puppeteer on Raspberry Pi
print_status "Installing additional system dependencies..."
$SUDO apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libc6 \
    libcairo-gobject2 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
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
    lsb-release \
    wget \
    xdg-utils

print_success "System dependencies installed"

# Install PM2 for process management (optional but recommended)
print_status "Installing PM2 for process management..."
if ! command -v pm2 &> /dev/null; then
    $SUDO npm install -g pm2
    print_success "PM2 installed successfully"
else
    print_success "PM2 is already installed"
fi

# Create application directory structure
print_status "Setting up application directory..."
APP_DIR="/opt/veo-dongle"
$SUDO mkdir -p $APP_DIR
$SUDO cp -r . $APP_DIR/
$SUDO chown -R $USER:$USER $APP_DIR

# Navigate to application directory
cd $APP_DIR

# Install project dependencies
print_status "Installing project dependencies..."
npm install --production

# Fix security vulnerabilities
print_status "Fixing security vulnerabilities..."
npm audit fix

# Create system user for the application (optional)
print_status "Creating system user..."
if ! id "veodongle" &>/dev/null; then
    $SUDO useradd -r -s /bin/false veodongle
    print_success "System user 'veodongle' created"
else
    print_success "System user 'veodongle' already exists"
fi

# Set proper ownership
$SUDO chown -R veodongle:veodongle $APP_DIR
print_success "Permissions set for system user"

# Create environment file
if [[ ! -f .env ]]; then
    print_status "Creating .env file..."
    cat > .env << EOL
# Veo Dongle Raspberry Pi Environment Configuration
# Production settings for Raspberry Pi

# Veo Stream Configuration
VEO_STREAM_URL=https://live.veo.co/stream/YOUR_STREAM_ID
LOGIN_URL=https://live.veo.co/login
LOGIN_ENABLED=true

# Display Configuration (adjust for your display)
DISPLAY_WIDTH=1920
DISPLAY_HEIGHT=1080

# Server Configuration
PORT=3000
CLOUD_URL=http://localhost:4000

# Device Configuration
DEVICE_ID=raspberry-pi-prod-$(date +%s)

# Azure Table Storage Configuration (recommended for production cloud interaction)
AZURE_STORAGE_CONNECTION_STRING=
AZURE_TABLE_NAME=veoDongleStreams
AZURE_STORAGE_ENABLED=false
AZURE_POLL_INTERVAL=30000
AZURE_RETRY_ATTEMPTS=3

# Production Mode
NODE_ENV=production
EOL
    print_success ".env file created. Please edit with your actual values."
else
    print_warning ".env file already exists. Skipping creation."
fi

# Create credentials.json template
if [[ ! -f credentials.json ]]; then
    print_status "Creating credentials.json template..."
    cat > credentials.json << EOL
{
  "email": "your-veo-email@example.com",
  "password": "your-veo-password"
}
EOL
    print_warning "credentials.json template created. Update with your actual credentials."
    print_warning "⚠️  IMPORTANT: Add credentials.json to .gitignore to avoid committing sensitive data!"
else
    print_warning "credentials.json already exists. Skipping creation."
fi

# Create systemd service file for auto-start
print_status "Creating systemd service..."
SERVICE_FILE="/etc/systemd/system/veo-dongle.service"

cat > $SERVICE_FILE << EOL
[Unit]
Description=Veo Dongle Raspberry Pi
After=network.target
Wants=network.target

[Service]
Type=simple
User=veodongle
WorkingDirectory=$APP_DIR
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/veodongle/.X11/Xauthority
ExecStart=/usr/bin/node $APP_DIR/src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOL

# Set proper permissions for service file
$SUDO chmod 644 $SERVICE_FILE
print_success "Systemd service created"

# Enable and start the service
print_status "Enabling and starting the service..."
$SUDO systemctl daemon-reload
$SUDO systemctl enable veo-dongle.service
$SUDO systemctl start veo-dongle.service

print_success "Service enabled and started"

# Check service status
print_status "Checking service status..."
$SUDO systemctl status veo-dongle.service --no-pager

# Create a test script for validation
print_status "Creating validation test script..."
cat > test-validation.js << 'EOL'
#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testValidation() {
    console.log('🧪 Testing Raspberry Pi setup...');

    try {
        const browser = await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--start-fullscreen',
                '--kiosk'
            ]
        });

        const page = await browser.newPage();
        await page.goto('https://example.com');
        const title = await page.title();

        console.log('✅ Validation successful!');
        console.log('Page title:', title);
        console.log('Browser:', await browser.version());

        await browser.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Validation failed:', error.message);
        console.log('Check your configuration and try again.');
        process.exit(1);
    }
}

testValidation();
EOL

chmod +x test-validation.js

print_status "Running validation test..."
node test-validation.js || {
    print_warning "Validation test failed. Check your setup."
    print_warning "Common issues:"
    print_warning "- Display not configured properly"
    print_warning "- Permissions issues"
    print_warning "- Missing dependencies"
}

# Clean up test file
rm test-validation.js

# Create backup script
print_status "Creating backup script..."
cat > backup-config.sh << 'EOL'
#!/bin/bash
# Backup important configuration files

BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p $BACKUP_DIR

cp config.json $BACKUP_DIR/ 2>/dev/null || echo "No config.json found"
cp .env $BACKUP_DIR/ 2>/dev/null || echo "No .env found"
cp credentials.json $BACKUP_DIR/ 2>/dev/null || echo "No credentials.json found"

echo "Backup created in: $BACKUP_DIR"
EOL

chmod +x backup-config.sh

print_success "Backup script created"

# Final instructions
echo ""
print_success "Raspberry Pi setup completed!"
echo ""
print_status "Next steps:"
echo "1. Edit .env file with your actual configuration"
echo "2. Edit credentials.json with your Veo login credentials"
echo "3. Run 'sudo systemctl restart veo-dongle.service' to apply changes"
echo "4. Check logs with 'sudo journalctl -f -u veo-dongle.service'"
echo ""
print_status "Useful commands:"
echo "- Start service: sudo systemctl start veo-dongle.service"
echo "- Stop service: sudo systemctl stop veo-dongle.service"
echo "- Restart service: sudo systemctl restart veo-dongle.service"
echo "- Check status: sudo systemctl status veo-dongle.service"
echo "- View logs: sudo journalctl -f -u veo-dongle.service"
echo "- Backup config: ./backup-config.sh"
echo ""
print_warning "Make sure to:"
echo "- Configure your display resolution in .env file"
echo "- Add credentials.json to .gitignore"
echo "- Set up proper authentication credentials"
echo "- Test the service after configuration changes"
echo ""
print_status "For more information, see the README.md file"
