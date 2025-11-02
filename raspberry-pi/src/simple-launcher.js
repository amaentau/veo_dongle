#!/usr/bin/env node

/**
 * Simple launcher application
 * 1. Reads latest URL from bulletin board for "koti" key (one time)
 * 2. Launches Chromium browser to this URL
 * 3. Exits
 */

const puppeteer = require('puppeteer');
const { spawn, execFile } = require('child_process');
const CloudService = require('./cloud-service');
const path = require('path');
const fs = require('fs');

class SimpleLauncher {
  constructor() {
    this.config = this.loadConfig();
    this.cloudService = null;
    this.browser = null;
    this.page = null;
    this.credentials = this.loadCredentials();
    this.forcePuppeteer = false; // enable when we need scripted login
    this.remoteDebugPort = 9222;
  }

  async performNavigateOnly(streamUrl) {
    console.log('🌐 Navigating to stream URL...');
    console.log('   URL:', streamUrl);
    try {
      await this.page.goto(streamUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      console.log('✅ Browser navigated to stream URL');
    } catch (e) {
      console.error('❌ Navigation failed:', e.message);
    }
  }

  async performLoginAndNavigate(streamUrl) {
    const loginUrl = (this.config && this.config.login && this.config.login.url) || 'https://live.veo.co/login';
    const { email, password } = this.credentials;

    console.log('🔐 Starting login flow...');
    console.log('🔐 Navigating to login page:', loginUrl);

    // Always open login in a new tab to avoid attaching to a blank/initial page
    const context = this.browser.defaultBrowserContext ? this.browser.defaultBrowserContext() : null;
    const page = await (this.browser.newPage ? this.browser.newPage() : (context ? context.newPage() : null));
    this.page = page || this.page;
    await this.page.bringToFront();
    await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Basic selectors; may need adjustment if the site changes
    const emailSelector = 'input[type="email"], input[name="email"], #email';
    const passwordSelector = 'input[type="password"], input[name="password"], #password';
    const submitSelector = 'button[type="submit"], button[data-testid*="login"], button:has-text("Log in"), button:has-text("Sign in")';

    // Wait for email field
    await this.page.waitForSelector(emailSelector, { timeout: 20000 });
    await this.page.type(emailSelector, email, { delay: 20 });

    // Wait for password field
    await this.page.waitForSelector(passwordSelector, { timeout: 20000 });
    await this.page.type(passwordSelector, password, { delay: 20 });

    // Try clicking submit; fall back to pressing Enter
    try {
      const submit = await this.page.$(submitSelector);
      if (submit) {
        await submit.click();
      } else {
        await this.page.keyboard.press('Enter');
      }
    } catch {
      await this.page.keyboard.press('Enter');
    }

    // Wait for navigation after login
    try {
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    } catch {}

    // Navigate to the stream URL after login
    console.log('🌐 Navigating to stream URL after login...');
    const streamTab = await this.browser.newPage();
    await streamTab.bringToFront();
    await streamTab.goto(streamUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Optional: verify some content
    const title = await this.page.title();
    console.log('📄 Page title:', title || 'No title');
  }

  loadConfig() {
    const configDir = path.join(__dirname, '..');

    // Try to load JSON config first
    try {
      const jsonConfigPath = path.join(configDir, 'config.json');
      if (fs.existsSync(jsonConfigPath)) {
        console.log('📋 Loading configuration from config.json');
        return JSON.parse(fs.readFileSync(jsonConfigPath, 'utf8'));
      }
    } catch (error) {
      console.warn('⚠️ Failed to load JSON config:', error.message);
    }

    // Return default configuration
    console.log('📋 Using default configuration');
    return {
      veoStreamUrl: 'https://example.com/veo-stream',
      port: 3000,
      cloudUrl: 'http://localhost:4000',
      deviceId: 'raspberry-pi-001',
      azure: {
        bbsUrl: 'https://bbs-web-123.azurewebsites.net',
        enabled: true,
        pollInterval: 5000,
        retryAttempts: 3
      },
      viewport: { width: 1920, height: 1080 },
      chromium: {
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--ignore-certificate-errors',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-infobars',
          '--kiosk',
          '--start-fullscreen'
        ]
      }
    };
  }

  detectWSL() {
    try {
      return fs.existsSync('/proc/version') && fs.readFileSync('/proc/version', 'utf8').includes('Microsoft');
    } catch {
      return false;
    }
  }

  detectEnvironment() {
    const isWSL = this.detectWSL();
    const hasDisplay = !!process.env.DISPLAY;

    console.log(`🌍 Environment detection:`);
    console.log(`   - WSL: ${isWSL}`);
    console.log(`   - DISPLAY: ${process.env.DISPLAY || 'Not set'}`);
    console.log(`   - Has GUI: ${hasDisplay}`);
    console.log(`   - Platform: ${process.platform}`);
    console.log(`   - Node version: ${process.version}`);

    // Check if we're in a container or restricted environment
    const isContainer = fs.existsSync('/.dockerenv') || process.env.CONTAINER;
    console.log(`   - Container: ${isContainer}`);

    return { isWSL, hasDisplay, isContainer };
  }

  loadCredentials() {
    try {
      const credPath = path.join(__dirname, '..', 'credentials.json');
      if (!fs.existsSync(credPath)) {
        return null;
      }
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      if (!creds || !creds.email || !creds.password) {
        console.warn('⚠️ credentials.json missing email or password; login disabled');
        return null;
      }
      console.log('🔐 credentials.json found');
      return creds;
    } catch (e) {
      console.warn('⚠️ Failed to load credentials.json:', e.message);
      return null;
    }
  }

  getSystemChromiumPath() {
    const candidates = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch {}
    }
    return null;
  }

  async launchBrowser(targetUrl = null) {
    console.log('🚀 Launching Chromium...');

    const env = this.detectEnvironment();

    // Determine if we should use headless mode
    const headlessMode = !env.hasDisplay || env.isContainer || process.argv.includes('--headless') || process.argv.includes('--no-gui');
    console.log(`📺 Browser mode: ${headlessMode ? 'Headless' : 'GUI'}`);

    if (headlessMode && !env.hasDisplay) {
        console.log('ℹ️ Using headless mode (no display available)');
    }
    if (headlessMode && env.isContainer) {
        console.log('ℹ️ Using headless mode (container environment)');
    }

    // Decide engine: use Puppeteer only when explicitly requested (or login flow requested)
    const usePuppeteerChromiumFlag = process.argv.includes('--puppeteer-chromium') || process.argv.includes('--puppeteer') || process.argv.includes('--login');
    const useSystemChromiumFlag = !usePuppeteerChromiumFlag;
    const useSystemChromium = useSystemChromiumFlag;
    console.log(`🔧 Browser engine: ${useSystemChromium ? 'System Chromium' : 'Puppeteer bundled'}`);

    // Configure browser launch options
    let launchOptions;

    if (useSystemChromium) {
        // Use system Chrome/Chromium with minimal arguments
        console.log('🔧 Using system Chrome');
        const systemPath = this.getSystemChromiumPath();
        launchOptions = {
            headless: headlessMode,
            executablePath: systemPath || 'google-chrome-stable',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--new-window'],
            defaultViewport: null,
            timeout: 30000
        };
    } else {
        // Use Puppeteer with system Chromium when available, minimal flags
        const systemPath = this.getSystemChromiumPath();
        launchOptions = {
            headless: headlessMode,
            executablePath: systemPath || undefined,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--new-window'],
            defaultViewport: null,
            timeout: 30000
        };
    }

    // Do not force kiosk/fullscreen; we want identical behavior to manual call

    // Additional environment-specific options for non-GUI environments
    if (env.isWSL || !env.hasDisplay || headlessMode) {
      // Extra options for WSL/container/headless environments
      launchOptions.args.push(
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--no-crash-upload',
        '--disable-login-animations',
        '--disable-notifications'
      );
    }

    console.log('🔧 Launch options:', JSON.stringify(launchOptions, null, 2));

    try {
        console.log('🔄 Attempting to launch browser...');
        this.browser = await puppeteer.launch(launchOptions);
        console.log('✅ Browser launched successfully');
    } catch (launchError) {
        console.error('❌ Browser launch failed:', launchError.message);
        console.error('❌ Error details:', launchError);

        // Try with even more basic options
        console.log('🔄 Retrying with minimal options...');
        const minimalOptions = {
            headless: headlessMode,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ],
            timeout: 10000
        };

        console.log('🔧 Minimal launch options:', JSON.stringify(minimalOptions, null, 2));
        this.browser = await puppeteer.launch(minimalOptions);
        console.log('✅ Browser launched with minimal options');
    }

    // Use initial page instead of creating new one
    const pages = await this.browser.pages();
    console.log(`📄 Pages after launch: ${pages.length}`);

    if (pages.length > 0) {
      this.page = pages[0];
      console.log('✅ Using initial page');
    } else {
      this.page = await this.browser.newPage();
      console.log('✅ Created new page');
    }

    await this.page.setViewport({
      width: this.config.viewport?.width || 1920,
      height: this.config.viewport?.height || 1080
    });

    // Setup basic logging
    this.page.on('console', (msg) => console.log(`📜 [page] ${msg.type()}:`, msg.text()));
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page.mainFrame()) {
        console.log(`🚦 Navigation: ${frame.url()}`);
      }
    });

    console.log('✅ Browser launched successfully');

    // If a target URL was provided, navigate immediately
    if (targetUrl) {
      try {
        console.log('🌐 [Puppeteer] Navigating to:', targetUrl);
        await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('✅ [Puppeteer] Navigation complete');
      } catch (e) {
        console.error('❌ [Puppeteer] Navigation failed:', e.message);
      }
    }
  }

  /**
   * Launch system Chromium directly (preferred on WSL) and open the given URL.
   * This avoids Puppeteer and mirrors the working manual command: chromium-browser <URL>
   */
  async launchSystemChromium(targetUrl) {
    // Defensive: log the exact URL
    console.log('🧪 LaunchSystemChromium URL:', JSON.stringify(targetUrl));
    const chromiumCandidates = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      'google-chrome-stable',
      'google-chrome',
      'chromium-browser',
      'chromium'
    ];

    let chromiumPath = null;
    for (const candidate of chromiumCandidates) {
      try {
        if (candidate.startsWith('/')) {
          if (fs.existsSync(candidate)) {
            chromiumPath = candidate;
            break;
          }
        } else {
          // Non-absolute: best effort, let spawn resolve PATH
          chromiumPath = candidate;
          break;
        }
      } catch {}
    }

    if (!chromiumPath) {
      throw new Error('Chrome/Chromium not found. Install google-chrome-stable or chromium-browser.');
    }

    // Use minimal args to mirror the manual command that works
    // IMPORTANT: Put URL as a distinct argument without quotes
    const args = ['--new-window', targetUrl];

    console.log('🧭 Launching system Chrome:', chromiumPath);
    console.log('🧭 With args:', JSON.stringify(args));

    execFile(chromiumPath, args, (err) => {
      if (err) {
        console.error('❌ system Chrome launch failed:', err.message);
      }
    });
    console.log('✅ System Chrome started');
  }

  async launchSystemChromiumWithDebug(openUrl) {
    const chromiumPath = this.getSystemChromiumPath() || 'google-chrome-stable';
    const userDataDir = `/tmp/veo-chromium-profile-${Date.now()}`;
    const port = this.remoteDebugPort;

    const args = [
      `--remote-debugging-port=${port}`,
      `--remote-debugging-address=127.0.0.1`,
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--new-window',
      openUrl
    ];

    console.log('🧭 Launching system Chrome with debug:', chromiumPath);
    console.log('🧭 Args:', JSON.stringify(args));

    execFile(chromiumPath, args, (err) => {
      if (err) console.error('❌ system Chrome launch failed:', err.message);
    });

    // Wait for devtools endpoint
    const endpoints = [
      `http://127.0.0.1:${port}/json/version`,
      `http://localhost:${port}/json/version`
    ];
    const start = Date.now();
    let wsEndpoint = null;
    while (Date.now() - start < 15000) {
      try {
        const res = await fetch(endpoints[0]).catch(() => fetch(endpoints[1]));
        if (res.ok) {
          const info = await res.json();
          if (info.webSocketDebuggerUrl) {
            wsEndpoint = info.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 300));
    }

    if (!wsEndpoint) throw new Error('DevTools endpoint not available');

    console.log('🔌 Connecting to Chromium DevTools...');
    // Add a connection timeout to avoid hanging indefinitely
    this.browser = await Promise.race([
      puppeteer.connect({ browserWSEndpoint: wsEndpoint }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Connect timeout')), 10000))
    ]);
    let pages = await this.browser.pages();
    console.log(`✅ Connected to running Chromium (pages: ${pages.length})`);
    // Prefer the Veo tab if already opened, else first page
    const veoPage = pages.find(p => {
      try { return (p.url() || '').includes('veo.co'); } catch { return false; }
    });
    this.page = veoPage || pages[0] || await this.browser.newPage();
  }

  async getStreamUrl() {
    console.log('🔍 Getting stream URL from BBS...');

    this.cloudService = new CloudService(this.config);

    try {
      await this.cloudService.initialize();
      console.log('✅ Cloud service initialized');

      // Get the URL for "koti" key (one time only)
      const kotiData = await this.cloudService.getLatestStreamUrl('koti');

      if (kotiData && kotiData.streamUrl) {
        console.log('✅ Found stream URL:', kotiData.streamUrl);
        return kotiData.streamUrl;
      } else {
        console.error('❌ No stream URL found for "koti" key');
        return null;
      }
    } catch (error) {
      console.error('❌ Failed to get stream URL:', error.message);
      return null;
    } finally {
      // Clean up cloud service (no polling needed)
      if (this.cloudService) {
        this.cloudService.cleanup();
        this.cloudService = null;
      }
    }
  }

  async run() {
    try {
      console.log('🎬 Veo Dongle Simple Launcher');
      console.log('============================');
      console.log('');

      // Step 1: Get the stream URL from BBS
      const streamUrl = await this.getStreamUrl();

      if (!streamUrl) {
        console.error('❌ Could not retrieve stream URL. Exiting...');
        process.exit(1);
      }

      console.log('');
      console.log('🎯 Ready to launch browser with URL:');
      console.log('   ', streamUrl);
      console.log('🔍 URL length:', (streamUrl || '').length);
      console.log('🔍 URL JSON:', JSON.stringify(streamUrl));
      console.log('');

      // Step 2: If credentials are present, attach to system Chromium and perform login.
      if (this.credentials) {
        await this.launchSystemChromiumWithDebug('about:blank');
        await this.performLoginAndNavigate(streamUrl);
        console.log('🎉 Login flow completed; keeping browser open');
        await new Promise(() => {});
      } else {
        // No credentials: prefer launching system Chromium directly (works in WSL)
        try {
          // Try app mode first, then window if needed
          await this.launchSystemChromium(streamUrl);
          console.log('🎉 Simple launcher completed successfully!');
          console.log('   Browser is now opening the stream URL.');
          process.exit(0);
        } catch (systemErr) {
          console.warn('⚠️ System chromium launch failed, falling back to Puppeteer:', systemErr.message);

          // Fallback to Puppeteer-controlled launch+navigation
          await this.launchBrowser();
          await this.performNavigateOnly(streamUrl);
          console.log('🔄 Keeping process alive for browser (fallback mode)...');
          await new Promise(() => {});
        }
      }

    } catch (error) {
      console.error('❌ Launcher failed:', error.message);
      console.error('Stack:', error.stack);

      // Clean up on error
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (closeError) {
          console.error('Error closing browser:', closeError.message);
        }
      }

      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const launcher = new SimpleLauncher();
  launcher.run().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

module.exports = SimpleLauncher;
