#!/bin/bash

# Fix script for browser launch issues in WSL

set -e

echo "🔧 Fixing Browser Launch Issues in WSL"
echo "======================================="
echo ""

# Colors
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

# Check current Node.js version
CURRENT_NODE=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
print_status "Current Node.js version: $(node --version)"

if [ "$CURRENT_NODE" -lt 20 ]; then
    print_warning "Node.js version is too old (need v20+)"
    print_status "Installing Node.js 20 LTS..."

    # Install Node.js 20
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    print_success "Node.js $(node --version) installed"
else
    print_success "Node.js version is sufficient"
fi
echo ""

# Install missing system libraries
print_status "Installing required system libraries..."
sudo apt-get update
sudo apt-get install -y \
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
    libgbm1 \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgtk-3-0 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libcairo2 \
    libatspi2.0-0

print_success "System libraries installed"
echo ""

# Navigate to project directory
cd /mnt/c/Users/amaen/source/veo_dongle/raspberry-pi

# Install/reinstall npm dependencies
print_status "Installing npm dependencies..."
npm install

print_success "npm dependencies installed"
echo ""

# Configure Puppeteer to use system Chromium
print_status "Configuring Puppeteer to use system Chromium..."

# Create a puppeteer config file
cat > .puppeteerrc.cjs << 'EOF'
const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Use system Chromium instead of downloading
  skipDownload: true,
  executablePath: '/usr/bin/chromium-browser',
};
EOF

print_success "Puppeteer configured"
echo ""

# Test browser launch
print_status "Testing browser launch..."

cat > test-browser-launch.js << 'EOF'
const puppeteer = require('puppeteer');

(async () => {
  console.log('Attempting to launch Chromium...');
  
  try {
    const browser = await puppeteer.launch({
      headless: false,
      executablePath: '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    
    console.log('✅ Browser launched successfully!');
    
    const page = await browser.newPage();
    await page.goto('https://example.com');
    console.log('✅ Page loaded successfully!');
    
    await page.waitForTimeout(2000);
    await browser.close();
    
    console.log('✅ Test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Browser launch failed:', error.message);
    process.exit(1);
  }
})();
EOF

node test-browser-launch.js

if [ $? -eq 0 ]; then
    print_success "Browser test passed!"
    rm test-browser-launch.js
else
    print_error "Browser test failed!"
    print_warning "You may need to:"
    print_warning "1. Install VcXsrv on Windows"
    print_warning "2. Start VcXsrv before running the application"
    print_warning "3. Ensure DISPLAY=:0 is set"
    rm test-browser-launch.js
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_success "All fixes applied successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "You can now run the application with:"
echo "  ./run.sh"
echo "  or"
echo "  npm start"
echo ""


