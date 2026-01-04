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

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      console.log('🔐 Detected login page, authenticating...');
      await this.loginToVeo();
      // After login, navigate back to the stream
      console.log(`🎬 Returning to stream: ${streamUrl}`);
      await this.page.goto(streamUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    await this.playStream();
    await this.sleep(500);
    await this.enterFullscreen();
  }

  async isLoginPage() {
    try {
      return await this.page.evaluate(() => {
        const path = (window.location.pathname || '').toLowerCase();
        const url = (window.location.href || '').toLowerCase();
        const hasEmail = !!document.querySelector('input[type="email"], input[name*="email" i], #email');
        const hasPassword = !!document.querySelector('input[type="password"], input[name*="password" i], #password');
        const hasAuthForm = !!document.querySelector('form[action*="login" i], form[action*="signin" i]');
        const loginMarkers = /login|signin|sign-in|authenticate/.test(path) || /login|signin/.test(url);
        return (hasEmail && hasPassword) || hasAuthForm || loginMarkers;
      });
    } catch (_) {
      return false;
    }
  }

  async loginToVeo() {
    if (!this.credentials) {
      console.log('⚠️ No credentials available for login');
      return;
    }

    try {
      // 1. Handle Cookie Banners first
      await this.page.evaluate(() => {
        const matches = ['accept', 'agree', 'consent', 'allow'];
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const btn of buttons) {
          const text = (btn.innerText || '').toLowerCase();
          if (matches.some(m => text.includes(m))) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      await this.sleep(1000);

      // 2. Fill Email
      const emailSelectors = ['input[type="email"]', 'input[name="email"]', '#email'];
      let emailEl = null;
      for (const sel of emailSelectors) {
        emailEl = await this.page.$(sel);
        if (emailEl) break;
      }
      if (emailEl) await emailEl.type(this.credentials.email, { delay: 50 });

      // 3. Fill Password
      const passSelectors = ['input[type="password"]', 'input[name="password"]', '#password'];
      let passEl = null;
      for (const sel of passSelectors) {
        passEl = await this.page.$(sel);
        if (passEl) break;
      }
      if (passEl) await passEl.type(this.credentials.password, { delay: 50 });

      // 4. Submit
      const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', '.login-button'];
      let submitClicked = false;
      for (const sel of submitSelectors) {
        const btn = await this.page.$(sel);
        if (btn) {
          await btn.click();
          submitClicked = true;
          break;
        }
      }

      if (!submitClicked) {
        await this.page.keyboard.press('Enter');
      }

      console.log('⏳ Waiting for navigation after login...');
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      console.log('✅ Login process completed');
    } catch (e) {
      console.error('❌ Robust login failed:', e.message);
    }
  }

  async waitForPlayerSurface(maxWaitMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const found = await this.page.evaluate(() => {
          return !!(document.querySelector('.veo-player-container') || document.querySelector('veo-player') || document.querySelector('video'));
        });
        if (found) return true;
      } catch (_) {}
      await this.sleep(200);
    }
    return false;
  }

  async waitForPlayerReady(maxWaitMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const ready = await this.page.evaluate(() => {
          const video = document.querySelector('video');
          return !!(video && video.readyState >= 3 && video.duration > 0);
        });
        if (ready) return true;
      } catch (_) {}
      await this.sleep(500);
    }
    return false;
  }

  async playStream() {
    console.log('▶️ Attempting to start stream playback...');
    try {
      if (await this.isLoginPage()) return;

      await this.waitForPlayerSurface(5000);
      
      if (await this.isVideoPlaying()) {
        console.log('✅ Video already playing');
        return;
      }

      await this.waitForPlayerReady(8000);
      await this.sleep(1000); // Stabilization
      
      await this.clickControl('play', 'play');
      
      await this.sleep(2000);
      if (await this.isVideoPlaying()) {
        console.log('✅ Playback successfully started');
      } else {
        console.warn('⚠️ Play click completed but video may not be playing yet');
      }
    } catch (e) {
      console.error('❌ Error starting playback:', e.message);
    }
  }

  async pauseStream() {
    console.log('⏸️ Attempting to pause stream playback...');
    try {
      if (await this.isLoginPage()) return;
      if (!(await this.isVideoPlaying())) {
        console.log('ℹ️ Already paused');
        return;
      }
      await this.clickControl('play', 'play'); // Toggle
      await this.sleep(1000);
    } catch (e) {
      console.error('❌ Error pausing playback:', e.message);
    }
  }

  async enterFullscreen() {
    console.log('🖥️ Attempting to enter fullscreen mode...');
    try {
      if (await this.isLoginPage()) return;
      await this.waitForPlayerSurface(3000);
      await this.clickControl('fullscreen', 'fullscreen');
    } catch (e) {
      console.error('❌ Error entering fullscreen:', e.message);
    }
  }

  async isVideoPlaying() {
    try {
      return await this.page.evaluate(() => {
        const v = document.querySelector('video');
        return !!(v && v.currentTime > 0 && !v.paused && !v.ended && v.readyState >= 3);
      });
    } catch (_) { return false; }
  }

  async clickControl(action, label = '') {
    const coords = await this.resolveClickCoordinates(action);
    this.logDebug(`準備点击 '${action}' at (${coords.x}, ${coords.y})`);
    
    await this.page.mouse.move(coords.x, coords.y);
    await this.showClickOverlay(coords.x, coords.y, label || action);
    await this.sleep(250);
    await this.page.mouse.click(coords.x, coords.y);
    
    this.logDebug(`🖱️ Clicked ${action} at (${coords.x}, ${coords.y})`);
  }

  async showClickOverlay(x, y, label = '') {
    if (!this.enableClickOverlay || !this.page) return;
    try {
      await this.page.evaluate((x, y, label) => {
        const id = `__veo_click_overlay_${Date.now()}`;
        const el = document.createElement('div');
        el.id = id;
        el.style.cssText = `
          position: fixed; left: ${x-12}px; top: ${y-12}px;
          width: 24px; height: 24px; border: 3px solid rgba(255,0,0,0.9);
          border-radius: 50%; background: rgba(255,0,0,0.15);
          z-index: 2147483647; pointer-events: none;
          box-shadow: 0 0 8px rgba(255,0,0,0.6);
          transition: opacity 0.4s ease, transform 0.4s ease;
        `;
        if (label) {
          const tag = document.createElement('div');
          tag.textContent = label;
          tag.style.cssText = 'position: absolute; top: 26px; left: -6px; font: bold 10px sans-serif; color: red; background: rgba(255,255,255,0.6); padding: 1px 3px; border-radius: 3px;';
          el.appendChild(tag);
        }
        document.body.appendChild(el);
        requestAnimationFrame(() => {
          el.style.transform = 'scale(1.25)';
          setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'scale(1)';
            setTimeout(() => el.remove(), 450);
          }, 350);
        });
      }, x, y, label);
    } catch (_) {}
  }

  async resolveClickCoordinates(action) {
    const width = await this.page.evaluate(() => window.innerWidth) || 1920;
    const source = this.cloudCoordinates || this.config.coordinates || {
      1280: { play: { x: 63, y: 681 }, fullscreen: { x: 1136, y: 678 } },
      1920: { play: { x: 87, y: 1032 }, fullscreen: { x: 1771, y: 1032 } },
      3840: { play: { x: 114, y: 2124 }, fullscreen: { x: 3643, y: 2122 } }
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
