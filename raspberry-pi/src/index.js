#!/usr/bin/env node

const puppeteer = require('puppeteer');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

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

    // Load configuration
    this.config = this.loadConfig();

    // Load credentials if available
    this.credentials = this.loadCredentials();

    // Override with command line arguments if provided
    this.streamUrl = process.argv[2] || this.config.veoStreamUrl || process.env.VEO_STREAM_URL || 'https://example.com/veo-stream';
    this.port = process.env.PORT || this.config.port || 3000;
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
        return JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
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

  async initialize() {
    console.log('Initializing Veo Dongle Raspberry Pi...');

    // Setup Express server for local control
    this.setupServer();

    // Launch Chromium browser
    await this.launchBrowser();

    // Navigate to veo stream
    await this.navigateToStream();

    // Setup socket.io for real-time control
    this.setupSocketControl();

    console.log(`Veo Dongle ready. Access control interface at http://localhost:${this.port}`);
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
  }

  async launchBrowser() {
    console.log('Launching Chromium browser...');

    // Use configuration from JSON or fallback to defaults
    const chromiumConfig = this.config.chromium || {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--start-fullscreen',
        '--kiosk',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    };

    this.browser = await puppeteer.launch({
      headless: chromiumConfig.headless,
      args: chromiumConfig.args,
      defaultViewport: this.config.viewport || null,
      ignoreDefaultArgs: ['--disable-extensions']
    });

    this.page = await this.browser.newPage();

    // Set viewport if specified
    if (this.config.viewport) {
      await this.page.setViewport(this.config.viewport);
    }

    console.log('Chromium browser launched successfully');
  }

  async loginToVeo() {
    if (!this.credentials || !this.config.login || !this.config.login.enabled) {
      console.log('Authentication not configured or disabled');
      return;
    }

    try {
      console.log('🔐 Authenticating with Veo...');

      const loginUrl = this.config.login.url || 'https://live.veo.co/login';

      console.log('🌐 Navigating to login page...');
      await this.page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      console.log('🔐 Filling login form...');

      // Wait for and fill email field
      await this.page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
      await this.page.type('input[type="email"]', this.credentials.email, { delay: 50 });

      // Wait for and fill password field
      await this.page.waitForSelector('input[type="password"]', { visible: true, timeout: 10000 });
      await this.page.type('input[type="password"]', this.credentials.password, { delay: 50 });

      // Wait for and click submit button
      await this.page.waitForSelector('button[type="submit"]', { visible: true, timeout: 10000 });
      await this.page.click('button[type="submit"]');

      // Wait for navigation after login
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });

      console.log('✅ Successfully authenticated with Veo');

    } catch (error) {
      console.error('❌ Login failed:', error.message);
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  async navigateToStream() {
    console.log(`🎯 Preparing to load veo stream: ${this.streamUrl}`);

    try {
      // Authenticate first if credentials are available
      await this.loginToVeo();

      // Navigate to the stream
      console.log('🎬 Navigating to stream...');
      await this.page.goto(this.streamUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait for stream to load
      console.log('⏳ Waiting for stream to load...');
      await this.page.waitForTimeout(3000);

      // Attempt to enter fullscreen automatically
      await this.enterFullscreen();

      // Trigger initial playback
      await this.playStream();

      console.log('✅ Successfully loaded and started veo stream');
    } catch (error) {
      console.error('❌ Error loading veo stream:', error.message);
      throw error;
    }
  }

  async enterFullscreen() {
    try {
      // Use coordinate-based clicking if coordinates are configured
      if (this.config.coordinates && this.config.coordinates.fullscreen) {
        const coords = this.config.coordinates.fullscreen;
        await this.page.mouse.click(coords.x, coords.y);
        console.log(`🖥️ Clicked fullscreen at coordinates (${coords.x}, ${coords.y})`);
      } else {
        // Fallback to JavaScript fullscreen API
        await this.page.evaluate(() => {
          const video = document.querySelector('video');
          if (video) {
            if (video.requestFullscreen) {
              video.requestFullscreen();
            } else if (video.webkitRequestFullscreen) {
              video.webkitRequestFullscreen();
            } else if (video.msRequestFullscreen) {
              video.msRequestFullscreen();
            }
          }

          // Also try document fullscreen
          if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
          } else if (document.documentElement.webkitRequestFullscreen) {
            document.documentElement.webkitRequestFullscreen();
          } else if (document.documentElement.msRequestFullscreen) {
            document.documentElement.msRequestFullscreen();
          }
        });
      }

      console.log('Entered fullscreen mode');
    } catch (error) {
      console.error('Error entering fullscreen:', error);
    }
  }

  async playStream() {
    try {
      // Use coordinate-based clicking if coordinates are configured
      if (this.config.coordinates && this.config.coordinates.playback) {
        const coords = this.config.coordinates.playback;
        await this.page.mouse.click(coords.x, coords.y);
        console.log(`▶️ Clicked play at coordinates (${coords.x}, ${coords.y})`);
      } else {
        // Fallback to HTML5 video API
        await this.page.evaluate(() => {
          const video = document.querySelector('video');
          if (video && video.paused) {
            video.play();
          }
        });
      }
      console.log('Stream playback started');
    } catch (error) {
      console.error('Error playing stream:', error);
      throw error;
    }
  }

  async pauseStream() {
    try {
      // Use coordinate-based clicking if coordinates are configured
      if (this.config.coordinates && this.config.coordinates.playback) {
        const coords = this.config.coordinates.playback;
        await this.page.mouse.click(coords.x, coords.y);
        console.log(`⏸️ Clicked pause at coordinates (${coords.x}, ${coords.y})`);
      } else {
        // Fallback to HTML5 video API
        await this.page.evaluate(() => {
          const video = document.querySelector('video');
          if (video && !video.paused) {
            video.pause();
          }
        });
      }
      console.log('Stream playback paused');
    } catch (error) {
      console.error('Error pausing stream:', error);
      throw error;
    }
  }

  setupSocketControl() {
    this.io.on('connection', (socket) => {
      console.log('Control client connected:', socket.id);

      socket.on('play', async () => {
        try {
          await this.playStream();
          socket.emit('status', { action: 'play', success: true });
        } catch (error) {
          socket.emit('error', { action: 'play', message: error.message });
        }
      });

      socket.on('pause', async () => {
        try {
          await this.pauseStream();
          socket.emit('status', { action: 'pause', success: true });
        } catch (error) {
          socket.emit('error', { action: 'pause', message: error.message });
        }
      });

      socket.on('fullscreen', async () => {
        try {
          await this.enterFullscreen();
          socket.emit('status', { action: 'fullscreen', success: true });
        } catch (error) {
          socket.emit('error', { action: 'fullscreen', message: error.message });
        }
      });

      socket.on('disconnect', () => {
        console.log('Control client disconnected:', socket.id);
      });
    });
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

    if (this.browser) {
      await this.browser.close();
    }

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

WebSocket Events:
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