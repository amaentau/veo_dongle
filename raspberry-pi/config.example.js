// Veo Dongle Raspberry Pi Configuration

module.exports = {
  veoStreamUrl: process.env.VEO_STREAM_URL || 'https://example.com/veo-stream',
  port: process.env.PORT || 3000,
  deviceId: process.env.DEVICE_ID || 'raspberry-pi-001',
  cloudUrl: process.env.CLOUD_URL || 'http://localhost:4000',

  azure: {
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
    tableName: process.env.AZURE_TABLE_NAME || 'veoDongleStreams',
    enabled: process.env.AZURE_STORAGE_ENABLED === 'true' || false,
    pollInterval: parseInt(process.env.AZURE_POLL_INTERVAL, 10) || 30000,
    retryAttempts: parseInt(process.env.AZURE_RETRY_ATTEMPTS, 10) || 3,
    bbsUrl: process.env.BBS_URL || ''
  },

  viewport: {
    width: parseInt(process.env.DISPLAY_WIDTH, 10) || 1920,
    height: parseInt(process.env.DISPLAY_HEIGHT, 10) || 1080,
    force: process.env.FORCE_VIEWPORT === 'true'
  },

  display: {
    modes: ['3840x2160', '1920x1080', '1280x720'],
    preferredMode: process.env.PREFERRED_MODE || 'auto'
  },

  login: {
    url: process.env.LOGIN_URL || 'https://live.veo.co/login',
    enabled: process.env.LOGIN_ENABLED === 'true'
  },

  coordinates: {
    click: { x: 100, y: 100 },
    fullscreen: { x: 1765, y: 1045 },
    playback: { x: 45, y: 1052 }
  },

  browser: {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-infobars',
      '--disable-web-security',
      '--disable-accelerated-2d-canvas',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=VizDisplayCompositor',
      '--disable-extensions-http-throttling',
      '--disable-ipc-flooding-protection',
      '--ignore-certificate-errors',
      '--kiosk',
      '--start-fullscreen'
    ]
  },

  environments: {
    raspberry: {
      browser: {
        extraArgs: [
          '--use-gl=egl',
          '--disable-gpu-compositing',
          '--disable-software-rasterizer'
        ]
      }
    },
    wsl: {
      viewport: {
        width: 1280,
        height: 720
      },
      browser: {
        args: [
          '--use-gl=swiftshader',
          '--use-angle=swiftshader',
          '--ignore-gpu-blocklist'
        ]
      }
    }
  }
};

