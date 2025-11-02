#!/bin/bash

# Upgrade Node.js in WSL to a version that supports Puppeteer
# Node.js v20 LTS is recommended

echo "🔧 Upgrading Node.js in WSL"
echo "============================"
echo ""

echo "Current Node.js version:"
node --version
echo ""

echo "📦 Installing Node.js v20 LTS using NodeSource..."
echo ""

# Remove old NodeSource repository if it exists
sudo rm -f /etc/apt/sources.list.d/nodesource.list

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo ""
echo "✅ Node.js installation complete!"
echo ""

echo "New Node.js version:"
node --version
echo ""

echo "npm version:"
npm --version
echo ""

# Navigate to project directory
cd /mnt/c/Users/amaen/source/veo_dongle/raspberry-pi

echo "📦 Reinstalling project dependencies with new Node.js version..."
echo ""

# Clean install
rm -rf node_modules package-lock.json
npm install

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Node.js upgrade complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "You can now run: ./run.sh"


