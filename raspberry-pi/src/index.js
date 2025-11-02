#!/usr/bin/env node

const puppeteer = require('puppeteer');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const socketIoClient = require('socket.io-client');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const CloudService = require('./cloud-service');

class VeoDongleRaspberryPi {
  constructor() {
    this.browser = null;
    this.page = null;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Cloud service connection (legacy Socket.IO)
    this.cloudSocket = null;
    this.cloudUrl = process.env.CLOUD_URL || 'http://localhost:4000';

    // Azure-based cloud service
    this.cloudService = null;

    // Device configuration
    this.deviceId = process.env.DEVICE_ID || `raspberry-pi-${Date.now()}`;

    // Load configuration
    this.config = this.loadConfig();

    // Load credentials if available
    this.credentials = this.loadCredentials();
    console.log(`🔐 Credentials loaded: ${this.credentials ? 'YES' : 'NO'}`);
    if (this.credentials) {
      console.log(`   Email: ${this.credentials.email ? '***' + this.credentials.email.slice(-10) : 'MISSING'}`);
      console.log(`   Password: ${this.credentials.password ? 'YES' : 'MISSING'}`);
    }

    // Debug: overlay click indicator (enabled by default; set SHOW_CLICK_OVERLAY=false to disable)
    this.enableClickOverlay = process.env.SHOW_CLICK_OVERLAY ? (process.env.SHOW_CLICK_OVERLAY === 'true') : true;

    // Override with command line arguments if provided
    this.streamUrl = process.argv[2] || this.config.veoStreamUrl || process.env.VEO_STREAM_URL || 'https://example.com/veo-stream';
    this.port = process.env.PORT || this.config.port || 3000;

    // Coordinate-based control map (CSS pixel coordinates)
    // Keys are base widths; scaling uses current render width
    this.clickControlMap = {
      1280: {
        play: { x: 63, y: 681 },
        fullscreen: { x: 1136, y: 678 },
        baseWidth: 1280
      },
      1920: {
        play: { x: 77, y: 1039 },
        fullscreen: { x: 1759, y: 1041 },
        baseWidth: 1920
      },
      3840: {
        play: { x: 114, y: 2124 },
        fullscreen: { x: 3643, y: 2122 },
        baseWidth: 3840
      }
    };
  }

  loadConfig() {
    const configDir = path.join(__dirname, '..');

    // Try to load JSON config first
    try {
      const jsonConfigPath = path.join(configDir, 'config.json');
      if (fs.existsSync(jsonConfigPath)) {
        console.log('Loading JSON configuration from config.json');
        return JSON.parse(fs.readFileSync(jsonConfigPath, 'utf8'));
      }
    } catch (error) {
      console.warn('Failed to load JSON config:', error.message);
    }

    // Fall back to JavaScript config
    try {
      const jsConfigPath = path.join(configDir, 'config.js');
      if (fs.existsSync(jsConfigPath)) {
        console.log('Loading JavaScript configuration from config.js');
        return require(jsConfigPath);
      }
    } catch (error) {
      console.warn('Failed to load JavaScript config:', error.message);
    }

    // Fall back to example config
    try {
      const exampleConfigPath = path.join(configDir, 'config.example.js');
      if (fs.existsSync(exampleConfigPath)) {
        console.log('Loading example configuration from config.example.js');
        return require(exampleConfigPath);
      }
    } catch (error) {
      console.warn('Failed to load example config:', error.message);
    }

    // Return default configuration
    console.log('Using default configuration');
    return {
      veoStreamUrl: 'https://example.com/veo-stream',
      port: 3000,
      cloudUrl: 'http://localhost:4000',
      deviceId: 'raspberry-pi-001',
      viewport: { width: 1920, height: 1080 },
      coordinates: {
        click: { x: 100, y: 100 },
        fullscreen: { x: 1765, y: 1045 },
        playback: { x: 45, y: 1052 }
      },
      chromium: {
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--start-fullscreen',
          '--kiosk'
        ]
      }
    };
  }

  loadCredentials() {
    const credentialsPath = path.join(__dirname, '..', 'credentials.json');

    try {
      if (fs.existsSync(credentialsPath)) {
        console.log('Loading credentials from credentials.json');
        const raw = fs.readFileSync(credentialsPath, 'utf8');
        // Strip UTF-8 BOM and trim to avoid JSON parse errors from editors adding BOM/newlines
        const sanitized = raw.replace(/^\uFEFF/, '').trim();
        return JSON.parse(sanitized);
      } else {
        console.log('No credentials.json found - authentication disabled');
        return null;
      }
    } catch (error) {
      console.error('Failed to load credentials:', error.message);
      console.log('Continuing without authentication...');
      return null;
    }
  }

  async connectToCloud() {
    console.log('🌐 Initializing cloud services...');

    try {
      // Initialize Azure-based cloud service (preferred method)
      if (this.config.azure && this.config.azure.enabled) {
        console.log('☁️ Using Azure Table Storage for cloud interaction');
        this.cloudService = new CloudService(this.config);

        await this.cloudService.initialize();

        // Set up callback for stream URL updates
        this.cloudService.onStreamUpdate(async (newStreamUrl, metadata) => {
          console.log(`🎯 Azure cloud requested new stream: ${newStreamUrl}`);
          await this.updateStreamFromCloud(newStreamUrl, metadata);
        });
      } else {
        console.log('⚠️ Azure Table Storage not enabled, checking for legacy Socket.IO...');

        // Fallback to legacy Socket.IO (for backward compatibility)
        if (this.cloudUrl && this.cloudUrl !== 'http://localhost:4000') {
          await this.connectToLegacyCloud();
        } else {
          console.log('⚠️ No cloud service configured, running in standalone mode');
        }
      }

      console.log('✅ Cloud services initialized');
    } catch (error) {
      console.error('❌ Error setting up cloud connection:', error.message);
      console.log('⚠️ Continuing without cloud connection...');
    }
  }

  async connectToLegacyCloud() {
    console.log(`🔌 Connecting to legacy cloud service at ${this.cloudUrl}...`);

    try {
      this.cloudSocket = socketIoClient(this.cloudUrl, {
        transports: ['websocket', 'polling'],
      });

      return new Promise((resolve, reject) => {
        this.cloudSocket.on('connect', () => {
          console.log('✅ Connected to legacy cloud service');

          // Register this device with the cloud
          const deviceInfo = {
            id: this.deviceId,
            name: 'Veo Dongle Raspberry Pi',
            type: 'raspberry-pi',
            status: 'connected',
            port: this.port,
            streamUrl: this.streamUrl
          };

          this.cloudSocket.emit('register', deviceInfo);
          console.log(`📝 Registered device: ${deviceInfo.name} (${deviceInfo.id})`);

          resolve();
        });

        this.cloudSocket.on('connect_error', (error) => {
          console.error('❌ Failed to connect to legacy cloud service:', error.message);
          console.log('⚠️ Continuing without cloud connection...');
          resolve(); // Don't fail the startup if cloud is unavailable
        });

        this.cloudSocket.on('disconnect', () => {
          console.log('📡 Disconnected from legacy cloud service');
        });

        // Handle commands from cloud service
        this.cloudSocket.on('play', async () => {
          try {
            await this.playStream();
            this.cloudSocket.emit('status', { action: 'play', success: true });
          } catch (error) {
            this.cloudSocket.emit('error', { action: 'play', message: error.message });
          }
        });

        this.cloudSocket.on('pause', async () => {
          try {
            await this.pauseStream();
            this.cloudSocket.emit('status', { action: 'pause', success: true });
          } catch (error) {
            this.cloudSocket.emit('error', { action: 'pause', message: error.message });
          }
        });

        this.cloudSocket.on('fullscreen', async () => {
          try {
            await this.enterFullscreen();
            this.cloudSocket.emit('status', { action: 'fullscreen', success: true });
          } catch (error) {
            this.cloudSocket.emit('error', { action: 'fullscreen', message: error.message });
          }
        });

        // Handle stream URL updates from cloud
        this.cloudSocket.on('stream', async (params) => {
          try {
            const { veoUrl } = params;
            console.log(`🎯 Legacy cloud requested new stream: ${veoUrl}`);
            await this.updateStreamFromCloud(veoUrl, { source: 'legacy-socket' });
          } catch (error) {
            console.error('❌ Error updating stream from legacy cloud:', error.message);
            this.cloudSocket.emit('error', {
              action: 'stream',
              message: error.message
            });
          }
        });
      });
    } catch (error) {
      console.error('❌ Error setting up legacy cloud connection:', error.message);
      console.log('⚠️ Continuing without cloud connection...');
    }
  }

  async updateStreamFromCloud(newStreamUrl, metadata = {}) {
    try {
      console.log(`🎬 Updating stream from cloud: ${newStreamUrl}`);

      // Store the current URL in cloud (for reference)
      if (this.cloudService) {
        await this.cloudService.storeStreamUrl(newStreamUrl, {
          previousUrl: this.streamUrl,
          source: metadata.source || 'azure',
          deviceId: this.deviceId
        });
      }

      // Update local stream URL
      this.streamUrl = newStreamUrl;

      // Navigate to the new stream
      await this.navigateToStream();

      console.log('✅ Stream updated successfully from cloud');
    } catch (error) {
      console.error('❌ Error updating stream from cloud:', error.message);
      throw error;
    }
  }

  async initialize() {
    console.log('Initializing Veo Dongle Raspberry Pi...');

    try {
      // Fetch stream URL from BBS first
      const bbsKey = process.env.BBS_KEY || 'koti';
      console.log(`🔍 Fetching stream URL from BBS (key: ${bbsKey})...`);
      const bbsUrl = await this.fetchBbsStreamUrlOnce(bbsKey);
      if (!bbsUrl) {
        throw new Error(`No stream URL found on BBS for key "${bbsKey}"`);
      }
      this.streamUrl = bbsUrl;
      console.log(`🎯 Using stream URL: ${this.streamUrl}`);

      // Setup server
      this.setupServer();

      // Launch browser
      await this.launchBrowser();

      // Setup auth handlers
      console.log('🛡️ Setting up auth handlers...');
      try {
        await this.setupAuthHandlers();
        console.log('✅ Auth handlers configured');
      } catch (error) {
        console.log('⚠️ Auth handler setup failed:', error.message);
      }

      // Try stream first - it might already be authenticated
      console.log('🎬 Loading stream...');

      try {
        await this.goToStream();
        console.log('✅ Stream loaded successfully');
      } catch (error) {
        console.log('⚠️ Stream loading failed:', error.message);
        console.log('🔄 This might need authentication, will check for login...');
      }

      // Only try login if we were redirected to a login page
      const currentUrl = this.page.url();

      if (currentUrl.includes('login') || currentUrl.includes('signin')) {
        console.log('🔐 Redirected to login, authenticating...');
        try {
          await this.loginToVeo();
          console.log('🎬 Going back to stream after login...');
          await this.goToStream();
        } catch (error) {
          console.log('⚠️ Login failed:', error.message);
        }
      }

      console.log(`✅ Veo Dongle ready. Access at http://localhost:${this.port}`);
    } catch (error) {
      console.error('❌ Initialization failed:', error.message);
      console.log('Starting recovery mode...');
      this.setupRecoveryMode();
    }
  }


  setupRecoveryMode() {
    console.log('Setting up recovery mode...');

    // Setup basic server without browser
    this.app.get('/recovery', (req, res) => {
      res.json({
        status: 'recovery',
        message: 'Browser failed to launch. Check logs for details.',
        timestamp: new Date().toISOString(),
        diagnostics: this.getDiagnostics()
      });
    });

    this.app.post('/recovery/restart', async (req, res) => {
      try {
        console.log('Manual restart requested...');
        await this.stop();
        await this.sleep(2000);
        await this.initialize();
        res.json({ success: true, message: 'Restart initiated' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    console.log('Recovery mode active. Access diagnostics at http://localhost:' + this.port + '/recovery');
  }

  getDiagnostics() {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      config: {
        port: this.port,
        streamUrl: this.streamUrl,
        hasCredentials: !!this.credentials,
        hasConfig: !!this.config,
        deviceId: this.deviceId
      },
      browser: {
        isRunning: !!this.browser,
        hasPage: !!this.page
      },
      cloud: {
        azureService: this.cloudService ? this.cloudService.getStatus() : null,
        legacySocket: {
          connected: !!this.cloudSocket,
          url: this.cloudUrl
        }
      }
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  

  async resolveClickCoordinates(action) {
    // Determine current render width
    let currentWidth = 0;
    try {
      currentWidth = await this.page.evaluate(() => window.innerWidth || document.documentElement.clientWidth || 0);
    } catch (_) {}
    if (!currentWidth) {
      try {
        const vp = this.page.viewport && this.page.viewport();
        currentWidth = (vp && vp.width) || 0;
      } catch (_) {}
    }
    if (!currentWidth) {
      currentWidth = (this.config.viewport && this.config.viewport.width) || 1920;
    }

    const bases = Object.keys(this.clickControlMap).map(n => parseInt(n, 10)).sort((a, b) => a - b);
    let chosenWidth = bases[0];
    let minDiff = Math.abs(currentWidth - bases[0]);
    for (const bw of bases) {
      const d = Math.abs(currentWidth - bw);
      if (d < minDiff) { minDiff = d; chosenWidth = bw; }
    }

    const ref = this.clickControlMap[chosenWidth];
    const base = ref && ref[action];
    if (!base) throw new Error(`No coordinates for action '${action}'`);

    const scale = currentWidth / (ref.baseWidth || chosenWidth);
    const scaled = { x: Math.round(base.x * scale), y: Math.round(base.y * scale) };
    console.log(`🎯 Using ${action} coords: baseWidth=${chosenWidth}, currentWidth=${currentWidth}, scale=${scale.toFixed(3)} → (${scaled.x}, ${scaled.y})`);
    return scaled;
  }

  async clickControl(action, label = '') {
    const coords = await this.resolveClickCoordinates(action);
    console.log(`🟢 Preparing click '${action}' at (${coords.x}, ${coords.y}) in 250ms`);
    await this.page.mouse.move(coords.x, coords.y);
    await this.showClickOverlay(coords.x, coords.y, label || action);
    await this.sleep(250);
    await this.page.mouse.click(coords.x, coords.y);
    console.log(`🖱️ Clicked ${action} at (${coords.x}, ${coords.y})`);
  }

  async showClickOverlay(x, y, label = '') {
    try {
      if (!this.enableClickOverlay || !this.page) return;
      await this.page.evaluate((x, y, label) => {
        try {
          const id = `__veo_click_overlay_${Date.now()}`;
          const el = document.createElement('div');
          el.id = id;
          el.style.position = 'fixed';
          el.style.left = `${Math.max(0, x - 12)}px`;
          el.style.top = `${Math.max(0, y - 12)}px`;
          el.style.width = '24px';
          el.style.height = '24px';
          el.style.border = '3px solid rgba(255,0,0,0.9)';
          el.style.borderRadius = '50%';
          el.style.background = 'rgba(255,0,0,0.15)';
          el.style.zIndex = '2147483647';
          el.style.pointerEvents = 'none';
          el.style.boxShadow = '0 0 8px rgba(255,0,0,0.6)';
          el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';

          if (label) {
            const tag = document.createElement('div');
            tag.textContent = label;
            tag.style.position = 'absolute';
            tag.style.top = '26px';
            tag.style.left = '-6px';
            tag.style.font = 'bold 10px sans-serif';
            tag.style.color = 'rgba(255,0,0,0.9)';
            tag.style.background = 'rgba(255,255,255,0.6)';
            tag.style.padding = '1px 3px';
            tag.style.borderRadius = '3px';
            tag.style.pointerEvents = 'none';
            el.appendChild(tag);
          }

          document.body.appendChild(el);
          // Trigger a small pulse effect
          requestAnimationFrame(() => {
            el.style.transform = 'scale(1.25)';
            setTimeout(() => {
              el.style.opacity = '0';
              el.style.transform = 'scale(1)';
              setTimeout(() => { el.remove(); }, 450);
            }, 350);
          });
        } catch {}
      }, x, y, label);
    } catch {}
  }

  

  

  

  setupServer() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Basic health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Stream control endpoints
    this.app.post('/control/play', async (req, res) => {
      try {
        await this.playStream();
        res.json({ success: true, action: 'play' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/control/pause', async (req, res) => {
      try {
        await this.pauseStream();
        res.json({ success: true, action: 'pause' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/control/fullscreen', async (req, res) => {
      try {
        await this.enterFullscreen();
        res.json({ success: true, action: 'fullscreen' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Cloud management endpoints
    this.setupCloudEndpoints();
  }

  setupCloudEndpoints() {
    // Get cloud service status
    this.app.get('/cloud/status', (req, res) => {
      const status = this.cloudService ? this.cloudService.getStatus() : {
        enabled: false,
        initialized: false,
        message: 'Cloud service not available'
      };

      res.json({
        cloud: status,
        legacySocket: {
          connected: !!this.cloudSocket,
          url: this.cloudUrl
        },
        currentStreamUrl: this.streamUrl,
        deviceId: this.deviceId
      });
    });

    // Update stream URL via API
    this.app.post('/cloud/stream', async (req, res) => {
      try {
        const { streamUrl } = req.body;

        if (!streamUrl) {
          return res.status(400).json({
            success: false,
            error: 'streamUrl is required'
          });
        }

        console.log(`🌐 API requested new stream: ${streamUrl}`);
        await this.updateStreamFromCloud(streamUrl, { source: 'api' });

        res.json({
          success: true,
          streamUrl,
          message: 'Stream URL updated successfully'
        });
      } catch (error) {
        console.error('❌ Error updating stream from API:', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Store stream URL in cloud (for Azure Table Storage)
    this.app.post('/cloud/store', async (req, res) => {
      try {
        const { streamUrl } = req.body;

        if (!streamUrl) {
          return res.status(400).json({
            success: false,
            error: 'streamUrl is required'
          });
        }

        if (!this.cloudService) {
          return res.status(503).json({
            success: false,
            error: 'Azure Table Storage not available'
          });
        }

        const result = await this.cloudService.storeStreamUrl(streamUrl, {
          source: 'api',
          deviceId: this.deviceId
        });

        res.json({
          success: true,
          streamUrl,
          timestamp: result.timestamp,
          message: 'Stream URL stored in cloud successfully'
        });
      } catch (error) {
        console.error('❌ Error storing stream URL in cloud:', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get latest stream URL from cloud
    this.app.get('/cloud/latest', async (req, res) => {
      try {
        if (!this.cloudService) {
          return res.status(503).json({
            success: false,
            error: 'Azure Table Storage not available'
          });
        }

        const key = req.query.key || null;
        const latestEntry = await this.cloudService.getLatestStreamUrl(key);

        res.json({
          success: true,
          key: key || this.deviceId,
          streamUrl: latestEntry ? latestEntry.streamUrl : null,
          timestamp: latestEntry ? latestEntry.timestamp : null,
          message: latestEntry ? 'Latest stream URL retrieved' : 'No stream URLs found'
        });
      } catch (error) {
        console.error('❌ Error retrieving latest stream URL:', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Manual cloud sync trigger
    this.app.post('/cloud/sync', async (req, res) => {
      try {
        if (this.cloudService) {
          await this.cloudService.checkForUpdates();
        }

        res.json({
          success: true,
          message: 'Cloud sync triggered'
        });
      } catch (error) {
        console.error('❌ Error during cloud sync:', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
  }

  async launchBrowser() {
    console.log('🚀 Launching Chromium...');

    const isWSL = this.detectWSL();
    console.log(`Environment: ${isWSL ? 'WSL' : 'Other'}`);

    // Use Puppeteer's bundled Chromium for better compatibility
    const launchOptions = {
      headless: false,
	executablePath: '/usr/bin/google-chrome-stable',
	ignoreDefaultArgs: ['--enable-automation'],
      // Ensure page viewport matches the window (avoid Puppeteer's 800x600 default)
      defaultViewport: null,
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
      ],
      timeout: 30000
    };

    if (isWSL) {
      // WSL-specific options for better GPU compatibility
      launchOptions.args.push(
        '--use-gl=swiftshader',
        '--use-angle=swiftshader',
        '--ignore-gpu-blocklist'
      );
    }

    console.log('🔧 Launch options:', launchOptions);
    this.browser = await puppeteer.launch(launchOptions);

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

    await this.page.bringToFront();

    // Optionally configure viewport presets if explicitly requested
    await this.setupViewport();

    // Enable click coordinate logging for manual capture
    await this.enableClickCoordinateLoggerSafe();

    // Log actual content viewport for diagnostics
    try {
      const size = await this.page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      }));
      console.log(`🖥️ Content viewport: ${size.width}x${size.height} @${size.dpr}x DPR`);
    } catch (_) {}

    console.log('✅ Browser launched');
  }


  detectWSL() {
    try {
      if (require('fs').existsSync('/proc/version')) {
        const version = require('fs').readFileSync('/proc/version', 'utf8');
        return version.toLowerCase().includes('microsoft');
      }
    } catch (error) {
      // Ignore errors in detection
    }
    return false;
  }

  async setupViewport() {
    try {
      const forceFlag = process.env.FORCE_VIEWPORT === 'true' || (this.config.viewport && this.config.viewport.force === true);
      const preset = process.env.VIEWPORT_PRESET || (this.config.viewport && this.config.viewport.preset) || '';

      // Map presets to sizes
      const presets = {
        '720p': { width: 1280, height: 720 },
        '1080p': { width: 1920, height: 1080 },
        '4k': { width: 3840, height: 2160 }
      };

      const explicit = this.config.viewport && typeof this.config.viewport.width === 'number' && typeof this.config.viewport.height === 'number'
        ? { width: this.config.viewport.width, height: this.config.viewport.height }
        : null;

      const chosen = presets[preset.toLowerCase()] || explicit;

      if (forceFlag && chosen) {
        await this.page.setViewport(chosen);
        console.log(`🖼️ Forced viewport to ${chosen.width}x${chosen.height} (preset: ${preset || 'explicit'})`);
      } else {
        console.log('🖼️ Using window-sized viewport (defaultViewport=null). Set FORCE_VIEWPORT=true to override.');
      }
    } catch (e) {
      console.log('⚠️ Viewport setup skipped:', e.message);
    }
  }

  async enableClickCoordinateLoggerSafe() {
    try {
      await this.enableClickCoordinateLogger();
    } catch (e) {
      console.log('⚠️ Click logger setup skipped:', e.message);
    }
  }

  async enableClickCoordinateLogger() {
    if (!this.page) return;
    try {
      // Expose a reporting function (idempotent)
      try {
        await this.page.exposeFunction('__veoReportClick', (payload) => {
          try {
            const { x, y, pageX, pageY, width, height, dpr, pctX, pctY, target, frameUrl } = payload || {};
            console.log(`🖱️ Click @ (${x}, ${y}) [page:${pageX},${pageY}] on ${width}x${height} (DPR=${dpr}) → ${pctX}% x, ${pctY}% y | target=<${target?.tag || '?'} aria="${target?.aria || ''}"> frame=${frameUrl || 'main'}`);
          } catch (e) {
            console.log('🖱️ Click payload error:', e.message);
          }
        });
      } catch (_) { /* already exposed */ }

      const inject = async (frame) => {
        try {
          await frame.evaluate(() => {
            try {
              if ((window).__veoClickLoggerInstalled) return;
              (window).__veoClickLoggerInstalled = true;
              const handler = (e) => {
                try {
                  const w = window.innerWidth || document.documentElement.clientWidth || 0;
                  const h = window.innerHeight || document.documentElement.clientHeight || 0;
                  const dpr = window.devicePixelRatio || 1;
                  const data = {
                    x: Math.round(e.clientX),
                    y: Math.round(e.clientY),
                    pageX: Math.round(e.pageX || 0),
                    pageY: Math.round(e.pageY || 0),
                    width: w,
                    height: h,
                    dpr,
                    pctX: w ? +(e.clientX / w * 100).toFixed(2) : null,
                    pctY: h ? +(e.clientY / h * 100).toFixed(2) : null,
                    target: {
                      tag: (e.target && e.target.tagName) || null,
                      aria: (e.target && e.target.getAttribute && e.target.getAttribute('aria-label')) || null
                    },
                    frameUrl: (window.location && window.location.href) || null
                  };
                  (window).__veoReportClick && (window).__veoReportClick(data);
                } catch {}
              };
              window.addEventListener('click', handler, true);
            } catch {}
          });
        } catch (_) { /* ignore frame evaluate errors */ }
      };

      // Inject into main frame and child frames
      await inject(this.page.mainFrame());
      for (const f of this.page.frames()) {
        await inject(f);
      }

      // Re-inject on future frame attachments
      this.page.on('frameattached', async (f) => {
        try { await inject(f); } catch (_) {}
      });
    } catch (e) {
      console.log('⚠️ Failed to enable click coordinate logger:', e.message);
    }
  }

  async waitForPlayerSurface(maxWaitMs = 4000) {
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

  async sendPlayerKey(key) {
    try {
      await this.page.bringToFront();
      await this.page.evaluate(() => {
        try {
          window.focus();
          const cont = document.querySelector('.veo-player-container') || document.body || document.documentElement;
          if (cont && cont.focus) cont.focus();
        } catch {}
      });
      await this.page.keyboard.press(key);
      console.log(`⌨️ Sent key: ${key}`);
    } catch (e) {
      console.log(`⚠️ Failed to send key '${key}': ${e.message}`);
    }
  }


  async fetchBbsStreamUrlOnce(key) {
    try {
      if (!this.config.azure || !this.config.azure.bbsUrl) {
        console.log('BBS URL not configured.');
        return null;
      }

      const endpoint = `${this.config.azure.bbsUrl}/entries/${encodeURIComponent(key)}`;
      console.log(`📡 Fetching BBS entries from: ${endpoint}`);

      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`BBS HTTP ${response.status}: ${response.statusText}`);
      }

      const entries = await response.json();
      if (entries && entries.length > 0 && entries[0] && entries[0].value1) {
        return entries[0].value1;
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to fetch from BBS:', error.message);
      return null;
    }
  }


  

  async setupAuthHandlers() {
    // Handle JavaScript password dialogs
    if (this.page && this.credentials) {
      this.page.on('dialog', async (dialog) => {
        try {
          if (dialog.type() === 'prompt' && this.credentials.password) {
            await dialog.accept(this.credentials.password);
            console.log('🔐 Password dialog accepted');
          } else {
            await dialog.dismiss();
          }
        } catch (e) {
          console.warn('Dialog error:', e.message);
        }
      });
    }
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
      console.log('⚠️ No credentials found, skipping login');
      return;
    }

    console.log('🔐 Starting login process...');

    try {
      // If we're not already on a login page, go to configured login URL once
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

      // Wait for page to fully load
      await this.sleep(2000);

      // Try to auto-accept common cookie consent banners to unblock inputs
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
          const knownSelectors = [
            '#onetrust-accept-btn-handler',
            '.onetrust-accept-btn-handler',
            '#consent-accept',
            '.cookie-accept',
          ];
          for (const sel of knownSelectors) {
            const el = document.querySelector(sel);
            if (el) { el.click(); return true; }
          }
          return false;
        });
        if (accepted) {
          await this.sleep(500);
        }
      } catch (_) {
        // Ignore consent errors
      }

      // Find and fill login form fields
      console.log('🔐 Filling login form fields...');

      // Try email field with expanded selectors
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name*="email" i]',
        '#email'
      ];

      let emailFound = false;
      for (const sel of emailSelectors) {
        try {
          const elements = await this.page.$$(sel);
          if (elements.length > 0) {
            await elements[0].type(this.credentials.email, { delay: 100 });
            emailFound = true;
            console.log(`✅ Email field found and filled: ${sel}`);
            break;
          }
        } catch (_) {}
      }

      // Try password field with expanded selectors
      const pwdSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[name*="password" i]',
        '#password'
      ];

      let pwdFound = false;
      for (const sel of pwdSelectors) {
        try {
          const elements = await this.page.$$(sel);
          if (elements.length > 0) {
            await elements[0].type(this.credentials.password, { delay: 100 });
            pwdFound = true;
            console.log(`✅ Password field found and filled: ${sel}`);
            break;
          }
        } catch (_) {}
      }

      if (!emailFound || !pwdFound) {
        console.log('⚠️ Could not find both email and password fields');
        return;
      }

      // Click submit button with comprehensive search
      console.log('🔘 Looking for submit button...');

      let clicked = false;

      // Try standard selectors first
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button[name="login"]',
        'button[name="signin"]',
        '[data-testid*="login" i]'
      ];

      for (const sel of submitSelectors) {
        try {
          const elements = await this.page.$$(sel);
          if (elements.length > 0) {
            await elements[0].click();
            clicked = true;
            console.log(`✅ Clicked submit button: ${sel}`);
            break;
          }
        } catch (_) {}
      }

      // No aggressive text-search clicking; fall back to pressing Enter

      if (!clicked) {
        // Last resort: try to find the form and submit it
        try {
          const formSubmitted = await this.page.evaluate(() => {
            const form = document.querySelector('form');
            if (form) {
              form.submit();
              return true;
            }
            return false;
          });
          if (formSubmitted) {
            console.log('✅ Submitted form directly');
            clicked = true;
          }
        } catch (_) {}
      }

      if (!clicked) {
        console.log('⚠️ No submit button found, pressing Enter...');
        await this.page.keyboard.press('Enter');
      }

      // Wait briefly for navigation or form submission
      const postSubmitWait = new Promise(resolve => setTimeout(resolve, 3000));
      await Promise.race([
        this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {}),
        postSubmitWait
      ]);
      console.log(`📍 After login attempt: ${this.page.url()}`);

      // Check if we're still on a login page or if login succeeded
      const stillOnLogin = await this.page.evaluate(() => {
        const currentPath = window.location.pathname.toLowerCase();
        const hasPasswordField = !!document.querySelector('input[type="password"]');
        return currentPath.includes('login') || currentPath.includes('signin') || hasPasswordField;
      });

      if (stillOnLogin) {
        console.log('⚠️ Still on login page, login may have failed');
      } else {
        console.log('✅ Login appears successful - redirected away from login page');
      }

    } catch (error) {
      console.error('❌ Login error:', error.message);
      // Don't throw - continue even if login fails
    }
  }

  async goToStream() {
    console.log(`🎬 Going to stream: ${this.streamUrl}`);

    try {
      // Check if this looks like a direct video stream URL
      const isDirectStream = this.streamUrl.includes('/stream/') && (this.streamUrl.includes('@') || this.streamUrl.includes('.mp4') || this.streamUrl.includes('.m3u8'));

      if (isDirectStream) {
        console.log('🎥 Detected direct video stream URL');
        console.log('📡 Navigating to direct stream...');

        // For direct streams, use load event instead of domcontentloaded
        await this.page.goto(this.streamUrl, {
          waitUntil: 'load',
          timeout: 20000
        });

        console.log(`📍 Direct stream loaded: ${this.page.url()}`);
        console.log('✅ Direct stream navigation completed');

        // Skip player actions if this unexpectedly is a login page
        if (await this.isLoginPage()) {
          console.log('🔐 Detected login page after direct stream load; skipping playback/fullscreen');
          return;
        }

        // Ensure click coordinate logger is active after navigation
        await this.enableClickCoordinateLoggerSafe();
        // Ensure playback starts and fullscreen is enabled (coordinate-based control)
        try {
          await this.playStream();
          await this.sleep(300);
          await this.enterFullscreen();
        } catch (e) {
          console.log('⚠️ Post-navigation coordinate control failed:', e.message);
        }
        return;
      }

      console.log('📡 Starting page navigation...');
      const navigationPromise = this.page.goto(this.streamUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Add a timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Navigation timeout after 30 seconds')), 30000);
      });

      await Promise.race([navigationPromise, timeoutPromise]);
      console.log(`📍 Stream URL loaded: ${this.page.url()}`);

      // Check if we're on a login page (skip player actions)
      if (await this.isLoginPage()) {
        console.log('🔐 Detected login page; skipping playback/fullscreen until after login');
        return;
      }

      // Ensure click coordinate logger is active after navigation
      await this.enableClickCoordinateLoggerSafe();

      // Small additional wait
      await this.sleep(500);

      console.log('✅ Stream navigation completed');

      // Coordinate-based control
      try {
        await this.playStream();
        await this.sleep(400);
        await this.enterFullscreen();
      } catch (e) {
        console.log('⚠️ Post-navigation coordinate control failed:', e.message);
      }

    } catch (error) {
      console.error('❌ Error loading stream:', error.message);
      throw error;
    }
  }

  async enterFullscreen() {
    console.log('🖥️ Attempting to enter fullscreen mode...');

    try {
      if (await this.isLoginPage()) {
        console.log('🔐 On login page; not toggling fullscreen');
        return;
      }
      // Give the player surface a short moment if needed
      await this.waitForPlayerSurface(3000);
      await this.clickControl('fullscreen', 'fullscreen');

    } catch (error) {
      console.error('❌ Error entering fullscreen:', error.message);
    }
  }

  async playStream() {
    console.log('▶️ Attempting to start stream playback...');

    try {
      if (await this.isLoginPage()) {
        console.log('🔐 On login page; not attempting to play background video');
        return;
      }
      // Give the player surface a short moment if needed
      await this.waitForPlayerSurface(3000);
      await this.clickControl('play', 'play');

    } catch (error) {
      console.error('❌ Error starting playback:', error.message);
      throw error;
    }
  }


  async pauseStream() {
    try {
      if (await this.isLoginPage()) {
        console.log('🔐 On login page; no need to pause');
        return;
      }
      // Toggle via play button coordinates as pause control (most players use same spot)
      await this.clickControl('play', 'pause');
      console.log('Stream playback paused');
    } catch (error) {
      console.error('Error pausing stream:', error);
      throw error;
    }
  }

  

  async start() {
    try {
      await this.initialize();
      this.server.listen(this.port, () => {
        console.log(`Server listening on port ${this.port}`);
      });
    } catch (error) {
      console.error('Failed to start Veo Dongle:', error);
      process.exit(1);
    }
  }

  async stop() {
    console.log('Stopping Veo Dongle...');

    // Stop cloud service polling
    if (this.cloudService) {
      this.cloudService.cleanup();
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
    }

    // Close server
    if (this.server) {
      this.server.close();
    }

    console.log('Veo Dongle stopped');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  const veoDongle = global.veoDongleInstance;
  if (veoDongle) {
    await veoDongle.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  const veoDongle = global.veoDongleInstance;
  if (veoDongle) {
    await veoDongle.stop();
  }
  process.exit(0);
});

// Command-line usage
function printUsage() {
  console.log(`
Veo Dongle Raspberry Pi - Stream Player

Usage:
  node src/index.js [stream-url] [options]

Arguments:
  stream-url    URL of the veo stream to play (optional, uses config if not provided)

Options:
  --help, -h    Show this help message
  --version, -v Show version information

Configuration:
  The application looks for configuration in this order:
  1. config.json (JSON format with your coordinate settings)
  2. config.js (JavaScript format)
  3. config.example.js (fallback example)

Examples:
  node src/index.js https://example.com/stream
  node src/index.js  # Uses URL from config.json
  node src/index.js --help

API Endpoints:
  GET  /health           # Health check
  POST /control/play     # Start playback
  POST /control/pause    # Pause playback
  POST /control/fullscreen # Toggle fullscreen

Cloud API Endpoints:
  GET  /cloud/status     # Cloud service status
  POST /cloud/stream     # Update stream URL via API
  POST /cloud/store      # Store stream URL in Azure Table Storage
  GET  /cloud/latest     # Get latest stream URL from cloud (use ?key=koti)
  POST /cloud/sync       # Trigger manual cloud sync

Recovery Endpoints:
  GET  /recovery         # Recovery mode diagnostics
  POST /recovery/restart # Manual restart

WebSocket Events (Legacy):
  play, pause, fullscreen - Control commands
`);
}

// Handle command line arguments
if (require.main === module) {
  // Check for help flag
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // Check for version flag
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    const packageInfo = require('../package.json');
    console.log(`Veo Dongle Raspberry Pi v${packageInfo.version}`);
    process.exit(0);
  }

  // Start the application
  const veoDongle = new VeoDongleRaspberryPi();
  global.veoDongleInstance = veoDongle;
  veoDongle.start().catch(error => {
    console.error('Failed to start Veo Dongle:', error);
    process.exit(1);
  });
}

module.exports = VeoDongleRaspberryPi;
