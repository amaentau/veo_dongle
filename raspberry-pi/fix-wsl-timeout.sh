#!/bin/bash

# Fix for WSL browser timeout issue
# The browser launches but Puppeteer times out waiting for it

echo "🔧 Fixing WSL Browser Timeout Issue"
echo "===================================="
echo ""

cd /mnt/c/Users/amaen/source/veo_dongle/raspberry-pi

# Create a Puppeteer configuration that works better with WSL
cat > .puppeteerrc.cjs << 'EOF'
const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Use system Chromium
  executablePath: '/usr/bin/chromium-browser',
  
  // WSL-specific launch options
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-tools',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-translate',
    '--disable-extensions',
    '--disable-sync'
  ]
};
EOF

echo "✅ Created Puppeteer configuration for WSL"
echo ""

# Test with a simple script
echo "🧪 Testing browser launch with new configuration..."

cat > test-wsl-browser.js << 'EOF'
const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser with WSL-optimized settings...');
  
  try {
    const browser = await puppeteer.launch({
      headless: false,
      executablePath: '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ],
      timeout: 90000,
      dumpio: false,
      protocolTimeout: 90000
    });
    
    console.log('✅ Browser launched!');
    
    const page = await browser.newPage();
    console.log('✅ Page created!');
    
    await page.goto('https://example.com', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    console.log('✅ Page loaded!');
    
    await page.waitForTimeout(3000);
    
    await browser.close();
    console.log('✅ Test completed successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
})();
EOF

node test-wsl-browser.js

if [ $? -eq 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ Browser launch test PASSED!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "The timeout issue should now be fixed."
    echo "You can now run: ./run.sh"
    rm test-wsl-browser.js
else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⚠️  Test still failing"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Additional troubleshooting needed:"
    echo "1. Ensure VcXsrv is running on Windows"
    echo "2. Check DISPLAY variable: echo \$DISPLAY"
    echo "3. Try: export DISPLAY=:0"
    echo "4. Restart WSL terminal"
    rm test-wsl-browser.js
    exit 1
fi


