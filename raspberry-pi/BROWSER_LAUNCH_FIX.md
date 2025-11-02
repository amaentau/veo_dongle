# 🔧 Fix: Chromium Browser Not Launching in WSL

## Problem

When running `./run.sh`, the application retrieves the stream URL from BBS successfully, but Chromium browser doesn't launch.

## Root Causes Identified

1. ❌ **Node.js v10 is too old** - Puppeteer requires Node.js 20+
2. ❌ **Puppeteer not properly installed** in WSL node_modules
3. ❌ **Missing system libraries** (libx11.so.6 and others)

## 🚀 Quick Fix (Automated)

Run the automated fix script:

```bash
# In WSL
cd /mnt/c/Users/amaen/source/veo_dongle/raspberry-pi
chmod +x fix-browser-wsl.sh
./fix-browser-wsl.sh
```

This script will:
- ✅ Upgrade Node.js to v20
- ✅ Install all required system libraries
- ✅ Reinstall npm dependencies
- ✅ Configure Puppeteer to use system Chromium
- ✅ Test browser launch

---

## 🔧 Manual Fix (Step-by-Step)

### Step 1: Upgrade Node.js

```bash
# In WSL
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version  # Should show v20.x.x or higher
```

### Step 2: Install Required System Libraries

```bash
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
    libpangocairo-1.0-0
```

### Step 3: Reinstall npm Dependencies

```bash
cd /mnt/c/Users/amaen/source/veo_dongle/raspberry-pi
rm -rf node_modules
npm install
```

### Step 4: Configure Puppeteer

Create `.puppeteerrc.cjs` file:

```javascript
const {join} = require('path');

module.exports = {
  skipDownload: true,
  executablePath: '/usr/bin/chromium-browser',
};
```

### Step 5: Test Browser Launch

```bash
node -e "
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('https://example.com');
  await page.waitForTimeout(2000);
  await browser.close();
})();
"
```

---

## 🖥️ X Server Setup (Required for GUI)

WSL needs an X server to display GUI applications like Chromium.

### Option 1: VcXsrv (Recommended)

1. **Download VcXsrv**:
   - https://sourceforge.net/projects/vcxsrv/

2. **Install and Start VcXsrv**:
   - Run XLaunch
   - Select "Multiple windows"
   - Display number: 0
   - Start no client
   - **Important**: Check "Disable access control"

3. **Configure WSL**:
```bash
export DISPLAY=:0
```

4. **Make it permanent** (add to ~/.bashrc):
```bash
echo 'export DISPLAY=:0' >> ~/.bashrc
```

### Option 2: WSLg (Windows 11 only)

If you have Windows 11, WSLg provides built-in GUI support:

```bash
# No additional setup needed, just ensure WSL is updated
wsl --update
```

---

## 🧪 Diagnostic Commands

### Check Current Status

```bash
# Run diagnostic script
./diagnose-browser.sh
```

### Manual Checks

```bash
# Check Node.js version
node --version

# Check Chromium installation
which chromium-browser
chromium-browser --version

# Check DISPLAY variable
echo $DISPLAY

# Test X server
xset q

# Check if Puppeteer is installed
ls -la node_modules/puppeteer

# Test Chromium launch
chromium-browser --no-sandbox --disable-setuid-sandbox https://example.com
```

---

## 🎯 After Fix - Launch Application

Once everything is fixed, launch the application:

```bash
# Method 1: Using run script
./run.sh

# Method 2: Using npm
npm start

# Method 3: Direct node
node src/index.js
```

### Expected Behavior

1. ✅ Application starts
2. ✅ Connects to BBS (https://bbs-web-123.azurewebsites.net)
3. ✅ Retrieves stream URL for "koti" key
4. ✅ **Chromium browser launches** in fullscreen/kiosk mode
5. ✅ Navigates to the stream URL
6. ✅ Starts playback automatically

---

## 🐛 Troubleshooting

### Issue: "Error: Failed to launch the browser process"

**Cause**: Missing system libraries or X server not running

**Solution**:
```bash
# Install missing libraries
sudo apt-get install -y libgbm1 libasound2 libx11-6

# Ensure X server (VcXsrv) is running
# Check DISPLAY variable
echo $DISPLAY  # Should show :0
```

### Issue: "connect ECONNREFUSED"

**Cause**: X server not accessible

**Solution**:
1. Start VcXsrv on Windows
2. Ensure "Disable access control" is checked
3. Restart WSL terminal

### Issue: Browser launches but shows blank screen

**Cause**: GPU acceleration issues in WSL

**Solution**: Already handled in config with `--disable-gpu` flag

### Issue: "DISPLAY not set"

**Solution**:
```bash
export DISPLAY=:0
```

---

## 📊 Verification Checklist

Before running the application, verify:

- [ ] Node.js version is 18 or higher (`node --version`)
- [ ] Chromium is installed (`which chromium-browser`)
- [ ] DISPLAY is set (`echo $DISPLAY` shows `:0`)
- [ ] X server is running (VcXsrv on Windows)
- [ ] npm dependencies are installed (`ls node_modules/puppeteer`)
- [ ] System libraries are installed (run `./diagnose-browser.sh`)

---

## 🎉 Success Indicators

When everything works correctly, you should see:

```
Loading JSON configuration from config.json
☁️ Using BBS HTTP endpoint: https://bbs-web-123.azurewebsites.net
✅ BBS HTTP service initialized successfully
📡 [BBS HTTP] Fetching entries from: https://bbs-web-123.azurewebsites.net/entries/koti
📖 [BBS HTTP] Retrieved latest stream URL for key "koti": https://live.veo.co/stream/...
Browser launch attempt 1/3
Launching Chromium browser...
Environment detected: Other
Production mode: false
Chromium browser launched successfully  ← THIS LINE CONFIRMS SUCCESS
🎯 Preparing to load veo stream: https://live.veo.co/stream/...
```

And you should see **Chromium browser window open** on your screen!

---

## 🚀 Quick Reference

```bash
# Full fix in one command
./fix-browser-wsl.sh

# Then launch
./run.sh

# Or
npm start
```

That's it! The browser should now launch successfully. 🎉


