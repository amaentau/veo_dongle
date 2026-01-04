const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Controls Chromium via Puppeteer for stream playback
 */
class PlayerController {
  constructor(config, deviceId, credentials) {
    this.config = config;
    this.deviceId = deviceId;
    this.credentials = credentials;
    this.browser = null;
    this.page = null;
    this.debug = process.env.DEBUG === 'true';
    this.enableClickOverlay = process.env.SHOW_CLICK_OVERLAY !== 'false';
    this.cloudCoordinates = null;
    this.runtimeEnvironment = process.env.RUNTIME_ENV || (this.detectWSL() ? 'wsl' : 'raspberry');
  }

  detectWSL() {
    try {
      if (fs.existsSync('/proc/version')) {
        return fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
      }
    } catch (_) {}
    return false;
  }

  logDebug(...args) {
    if (this.debug) console.log(...args);
  }

  async launchBrowser() {
    this.logDebug('🚀 Launching Chromium...');
    const browserConfig = this.config.browser || {};
    const resolvedExecutable = this.locateChromiumExecutable(browserConfig.executablePath);
    
    if (!resolvedExecutable) {
      throw new Error('Chromium executable not found.');
    }

    const defaultArgs = [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--kiosk', '--start-fullscreen', '--hide-scrollbars', '--disable-infobars',
      '--disable-web-security', '--autoplay-policy=no-user-gesture-required',
      '--ignore-certificate-errors', '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--enable-features=VaapiVideoDecoder', '--use-gl=egl', '--ignore-gpu-blocklist'
    ];

    if (this.runtimeEnvironment === 'wsl') {
      defaultArgs.push('--disable-features=VizDisplayCompositor', '--no-zygote');
    }

    this.browser = await puppeteer.launch({
      headless: browserConfig.headless ?? false,
      defaultViewport: null,
      executablePath: resolvedExecutable,
      args: defaultArgs,
      ignoreDefaultArgs: ['--enable-automation'],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':0'
      }
    });

    const pages = await this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
    await this.page.bringToFront();
    
    await this.setupAuthHandlers();
    await this.enableClickCoordinateLogger();
    console.log('✅ Browser launched');
  }

  locateChromiumExecutable(explicitPath) {
    const candidates = [process.env.CHROMIUM_PATH, explicitPath, '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome-stable'].filter(Boolean);
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  async setupAuthHandlers() {
    if (!this.page || !this.credentials) return;
    this.page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt' && this.credentials.password) {
        await dialog.accept(this.credentials.password);
        console.log('🔐 Password dialog accepted');
      } else {
        await dialog.dismiss();
      }
    });
  }

  async enableClickCoordinateLogger() {
    if (!this.page) return;
    try {
      await this.page.exposeFunction('__veoReportClick', (p) => {
        this.logDebug(`🖱️ Click @ (${p.x}, ${p.y}) on ${p.width}x${p.height}`);
      }).catch(() => {});

      const inject = async (frame) => {
        try {
          await frame.evaluate(() => {
            if (window.__veoClickLoggerInstalled) return;
            window.__veoClickLoggerInstalled = true;
            window.addEventListener('click', (e) => {
              const data = { x: Math.round(e.clientX), y: Math.round(e.clientY), width: window.innerWidth, height: window.innerHeight };
              window.__veoReportClick && window.__veoReportClick(data);
            }, true);
          });
        } catch (_) {}
      };

      await inject(this.page.mainFrame());
      this.page.on('frameattached', inject);
    } catch (_) {}
  }

  async goToStream(streamUrl) {
    console.log(`🎬 Going to stream: ${streamUrl}`);
    await this.page.goto(streamUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    if (await this.isLoginPage()) {
      console.log('🔐 Redirected to login, authenticating...');
      await this.loginToVeo();
      await this.page.goto(streamUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    await this.playStream();
    await new Promise(r => setTimeout(r, 500));
    await this.enterFullscreen();
  }

  async isLoginPage() {
    return await this.page.evaluate(() => {
      const path = window.location.pathname.toLowerCase();
      return path.includes('login') || path.includes('signin') || !!document.querySelector('input[type="password"]');
    });
  }

  async loginToVeo() {
    if (!this.credentials) return;
    try {
      await this.page.type('input[type="email"]', this.credentials.email, { delay: 100 });
      await this.page.type('input[type="password"]', this.credentials.password, { delay: 100 });
      await this.page.keyboard.press('Enter');
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    } catch (e) {
      console.error('❌ Login failed:', e.message);
    }
  }

  async playStream() {
    console.log('▶️ Starting playback...');
    if (await this.isVideoPlaying()) return;
    await this.clickControl('play');
  }

  async pauseStream() {
    console.log('⏸️ Pausing playback...');
    if (!(await this.isVideoPlaying())) return;
    await this.clickControl('play'); // Toggle
  }

  async enterFullscreen() {
    console.log('🖥️ Entering fullscreen...');
    await this.clickControl('fullscreen');
  }

  async isVideoPlaying() {
    try {
      return await this.page.evaluate(() => {
        const v = document.querySelector('video');
        return !!(v && v.currentTime > 0 && !v.paused && !v.ended && v.readyState >= 3);
      });
    } catch (_) { return false; }
  }

  async clickControl(action) {
    const coords = await this.resolveClickCoordinates(action);
    await this.page.mouse.click(coords.x, coords.y);
    this.logDebug(`🖱️ Clicked ${action} at (${coords.x}, ${coords.y})`);
  }

  async resolveClickCoordinates(action) {
    const width = await this.page.evaluate(() => window.innerWidth) || 1920;
    const source = this.cloudCoordinates || this.config.coordinates || {
      1280: { play: { x: 63, y: 681 }, fullscreen: { x: 1136, y: 678 } },
      1920: { play: { x: 87, y: 1032 }, fullscreen: { x: 1771, y: 1032 } }
    };
    
    const bases = Object.keys(source).map(Number).sort((a,b) => Math.abs(width-a) - Math.abs(width-b));
    const bestBase = bases[0] || 1920;
    const coords = source[bestBase][action];
    const scale = width / bestBase;
    
    return { x: Math.round(coords.x * scale), y: Math.round(coords.y * scale) };
  }

  async close() {
    if (this.browser) await this.browser.close();
  }
}

module.exports = PlayerController;

