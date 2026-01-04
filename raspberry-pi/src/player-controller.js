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

  async goToStream(streamUrl, isInitialBoot = true) {
    const startTime = Date.now();
    console.log(`🎬 Going to stream: ${streamUrl} (Boot: ${isInitialBoot})`);
    
    await this.page.goto(streamUrl, { 
      waitUntil: isInitialBoot ? 'networkidle2' : 'domcontentloaded', 
      timeout: 45000 
    });
    
    let isLogin = false;
    for (let i = 0; i < (isInitialBoot ? 10 : 2); i++) {
      isLogin = await this.isLoginPage();
      if (isLogin) break;
      await this.sleep(200);
    }

    if (isLogin) {
      console.log('🔐 Detected login page, authenticating...');
      await this.loginToVeo();
      console.log(`🎬 Returning to stream: ${streamUrl}`);
      await this.page.goto(streamUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    }

    await this.playStream(isInitialBoot);
    if (isInitialBoot) await this.sleep(500);
    await this.enterFullscreen(isInitialBoot);
    
    const elapsed = Date.now() - startTime;
    console.log(`⏱️ Performance: goToStream took ${elapsed}ms`);
  }

  async isLoginPage() {
    try {
      return await this.page.evaluate(() => {
        const path = (window.location.pathname || '').toLowerCase();
        const url = (window.location.href || '').toLowerCase();
        const hasEmail = !!document.querySelector('input[type="email"], input[name*="email" i], #email, input[id*="username" i]');
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
      console.log('⚠️ No credentials found, skipping login');
      return;
    }

    console.log('🔐 Starting login process...');

    try {
      const onLoginPage = await this.page.evaluate(() => {
        const hasEmail = !!document.querySelector('input[type="email"], input[name*="email" i], #email');
        const hasPassword = !!document.querySelector('input[type="password"], input[name*="password" i], #password');
        const currentPath = window.location.pathname.toLowerCase();
        return (hasEmail && hasPassword) || currentPath.includes('login') || currentPath.includes('signin');
      });

      if (!onLoginPage) {
        const loginUrl = this.config.login?.url || 'https://live.veo.co/login';
        console.log(`🌐 Navigating to login: ${loginUrl}`);
        await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      await this.sleep(2000);

      try {
        const accepted = await this.page.evaluate(() => {
          const matches = ['accept', 'agree', 'consent', 'allow'];
          const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
          for (const el of candidates) {
            const text = (el.innerText || el.value || '').toLowerCase();
            if (matches.some(m => text.includes(m))) {
              el.click();
              return true;
            }
          }
          const knownSelectors = ['#onetrust-accept-btn-handler', '.onetrust-accept-btn-handler', '#consent-accept', '.cookie-accept'];
          for (const sel of knownSelectors) {
            const el = document.querySelector(sel);
            if (el) { el.click(); return true; }
          }
          return false;
        });
        if (accepted) await this.sleep(500);
      } catch (_) {}

      this.logDebug('🔐 Filling login form fields...');

      const emailSelectors = ['input[type="email"]', 'input[name="email"]', 'input[name*="email" i]', '#email'];
      let emailFound = false;
      for (const sel of emailSelectors) {
        try {
          const elements = await this.page.$$(sel);
          if (elements.length > 0) {
            await elements[0].type(this.credentials.email, { delay: 100 });
            emailFound = true;
            this.logDebug(`✅ Email field found and filled: ${sel}`);
            break;
          }
        } catch (_) {}
      }

      const pwdSelectors = ['input[type="password"]', 'input[name="password"]', 'input[name*="password" i]', '#password'];
      let pwdFound = false;
      for (const sel of pwdSelectors) {
        try {
          const elements = await this.page.$$(sel);
          if (elements.length > 0) {
            await elements[0].type(this.credentials.password, { delay: 100 });
            pwdFound = true;
            this.logDebug(`✅ Password field found and filled: ${sel}`);
            break;
          }
        } catch (_) {}
      }

      if (!emailFound || !pwdFound) {
        this.logDebug('⚠️ Could not find both email and password fields');
        return;
      }

      await this.sleep(1000);
      this.logDebug('🔘 Looking for submit button...');

      let clicked = false;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries && !clicked; attempt++) {
        this.logDebug(`🔄 Submit button attempt ${attempt}/${maxRetries}`);

        const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', 'button[name="login"]', 'button[name="signin"]', '[data-testid*="login" i]'];

        for (const sel of submitSelectors) {
          try {
            await this.page.waitForFunction(
              (selector) => {
                const el = document.querySelector(selector);
                return el && el.offsetParent !== null && !el.disabled &&
                       (el.type !== 'submit' || !el.form || el.form.checkValidity() !== false);
              },
              { timeout: attempt === 1 ? 5000 : 2000 },
              sel
            );

            const elements = await this.page.$$(sel);
            if (elements.length > 0) {
              const isClickable = await elements[0].evaluate(el =>
                !el.disabled && el.offsetParent !== null &&
                window.getComputedStyle(el).visibility !== 'hidden'
              );

              if (isClickable) {
                await elements[0].click();
                clicked = true;
                this.logDebug(`✅ Clicked submit button: ${sel} (attempt ${attempt})`);
                break;
              }
            }
          } catch (e) {
            this.logDebug(`⚠️ Submit button selector failed: ${sel} (attempt ${attempt}) - ${e.message}`);
          }
        }

        if (!clicked && attempt < maxRetries) {
          await this.sleep(attempt * 1000);
        }
      }

      if (!clicked) {
        try {
          const formSubmitted = await this.page.evaluate(() => {
            const form = document.querySelector('form');
            if (form && form.checkValidity()) {
              form.submit();
              return true;
            }
            const submitBtn = form?.querySelector('button[type="submit"], input[type="submit"]');
            if (submitBtn && !submitBtn.disabled) {
              submitBtn.click();
              return true;
            }
            return false;
          });
          if (formSubmitted) clicked = true;
        } catch (e) {}
      }

      if (!clicked) await this.page.keyboard.press('Enter');

      const postSubmitWait = new Promise(resolve => setTimeout(resolve, 8000));
      const navigationPromise = this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});

      await Promise.race([navigationPromise, postSubmitWait]);
      this.logDebug(`📍 After login attempt: ${this.page.url()}`);
    } catch (error) {
      console.error('❌ Login error:', error.message);
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

  async playStream(isInitialBoot = false) {
    const startTime = Date.now();
    console.log(`▶️ Play action triggered (FastPath: ${!isInitialBoot})`);
    
    try {
      if (await this.isLoginPage()) return;

      if (isInitialBoot) {
        await this.waitForPlayerSurface(5000);
        if (await this.isVideoPlaying()) {
          console.log('✅ Video already playing');
          return;
        }
        await this.waitForPlayerReady(8000);
        await this.sleep(1000); // Stabilization
      }
      
      await this.clickControl('play', 'play', !isInitialBoot);
      
      if (isInitialBoot) {
        await this.sleep(2000);
        console.log(`✅ Initial boot play verification: ${await this.isVideoPlaying() ? 'PLAYING' : 'NOT PLAYING'}`);
      }
      
      const elapsed = Date.now() - startTime;
      console.log(`⏱️ Performance: playStream took ${elapsed}ms`);
    } catch (e) {
      console.error('❌ Error in playStream:', e.message);
    }
  }

  async pauseStream() {
    const startTime = Date.now();
    console.log('⏸️ Pause action triggered (FastPath: true)');
    try {
      if (await this.isLoginPage()) return;
      await this.clickControl('play', 'play', true);
      console.log(`⏱️ Performance: pauseStream took ${Date.now() - startTime}ms`);
    } catch (e) {
      console.error('❌ Error in pauseStream:', e.message);
    }
  }

  async enterFullscreen(isInitialBoot = false) {
    const startTime = Date.now();
    console.log(`🖥️ Fullscreen action triggered (FastPath: ${!isInitialBoot})`);
    try {
      if (await this.isLoginPage()) return;
      if (isInitialBoot) await this.waitForPlayerSurface(3000);
      await this.clickControl('fullscreen', 'fullscreen', !isInitialBoot);
      console.log(`⏱️ Performance: enterFullscreen took ${Date.now() - startTime}ms`);
    } catch (e) {
      console.error('❌ Error in enterFullscreen:', e.message);
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

  async clickControl(action, label = '', fastPath = false) {
    const coords = await this.resolveClickCoordinates(action);
    this.logDebug(`准备点击 '${action}' at (${coords.x}, ${coords.y}) (Fast: ${fastPath})`);
    
    if (!fastPath) {
      await this.page.mouse.move(coords.x, coords.y);
      await this.showClickOverlay(coords.x, coords.y, label || action);
      await this.sleep(250);
    } else {
      // Near-instant path: Jump directly to click
      this.showClickOverlay(coords.x, coords.y, label || action); // Fire and forget
    }
    
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
