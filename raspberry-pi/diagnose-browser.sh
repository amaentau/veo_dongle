#!/bin/bash

# Diagnostic script to check why Chromium isn't launching

echo "🔍 Diagnosing Browser Launch Issue"
echo "===================================="
echo ""

# Check Node.js version
echo "1. Node.js Version:"
node --version
echo ""

# Check if Chromium is installed
echo "2. Chromium Installation:"
if command -v chromium-browser &> /dev/null; then
    echo "✅ Chromium is installed: $(which chromium-browser)"
    chromium-browser --version 2>&1 | head -1
else
    echo "❌ Chromium is NOT installed"
fi
echo ""

# Check DISPLAY variable
echo "3. Display Configuration:"
if [ -n "$DISPLAY" ]; then
    echo "✅ DISPLAY is set: $DISPLAY"
else
    echo "❌ DISPLAY is NOT set (required for GUI apps)"
fi
echo ""

# Check if X server is accessible
echo "4. X Server Test:"
if command -v xset &> /dev/null; then
    if xset q &>/dev/null; then
        echo "✅ X server is accessible"
    else
        echo "❌ X server is NOT accessible"
        echo "   You need to install and run an X server (e.g., VcXsrv)"
    fi
else
    echo "⚠️  xset not installed, cannot test X server"
fi
echo ""

# Check Puppeteer installation
echo "5. Puppeteer Configuration:"
cd /mnt/c/Users/amaen/source/veo_dongle/raspberry-pi
if [ -d "node_modules/puppeteer" ]; then
    echo "✅ Puppeteer is installed"
    
    # Try to get Puppeteer's bundled Chromium path
    PUPPETEER_CHROMIUM=$(node -e "try { const puppeteer = require('puppeteer'); console.log(puppeteer.executablePath()); } catch(e) { console.log('Error:', e.message); }" 2>&1)
    echo "   Puppeteer Chromium: $PUPPETEER_CHROMIUM"
    
    if [ -f "$PUPPETEER_CHROMIUM" ]; then
        echo "   ✅ Puppeteer's Chromium exists"
    else
        echo "   ⚠️  Puppeteer's Chromium not found at expected location"
    fi
else
    echo "❌ Puppeteer is NOT installed"
fi
echo ""

# Check system Chromium
echo "6. System Chromium Test:"
if command -v chromium-browser &> /dev/null; then
    echo "Testing system Chromium launch..."
    timeout 5 chromium-browser --version &>/dev/null
    if [ $? -eq 0 ]; then
        echo "✅ System Chromium can be executed"
    else
        echo "⚠️  System Chromium execution test timed out or failed"
    fi
fi
echo ""

# Check required libraries
echo "7. Required Libraries:"
LIBS=("libgbm.so.1" "libx11.so.6" "libxcb.so.1")
for lib in "${LIBS[@]}"; do
    if ldconfig -p | grep -q "$lib"; then
        echo "✅ $lib found"
    else
        echo "❌ $lib NOT found"
    fi
done
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SUMMARY:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -z "$DISPLAY" ]; then
    echo "⚠️  MAIN ISSUE: DISPLAY not set"
    echo ""
    echo "SOLUTION:"
    echo "1. Install VcXsrv on Windows:"
    echo "   https://sourceforge.net/projects/vcxsrv/"
    echo ""
    echo "2. Start VcXsrv with these settings:"
    echo "   - Multiple windows"
    echo "   - Display number: 0"
    echo "   - Disable access control"
    echo ""
    echo "3. In WSL, set DISPLAY:"
    echo "   export DISPLAY=:0"
fi

if ! command -v chromium-browser &> /dev/null; then
    echo "⚠️  ISSUE: Chromium not installed"
    echo ""
    echo "SOLUTION:"
    echo "sudo apt-get update"
    echo "sudo apt-get install -y chromium-browser"
fi

echo ""
echo "For WSL GUI apps, you may also need:"
echo "sudo apt-get install -y libgbm1 libasound2"
echo ""


