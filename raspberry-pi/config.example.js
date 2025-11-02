// Veo Dongle Raspberry Pi Configuration

module.exports = {
  // Veo stream URL to load
  veoStreamUrl: process.env.VEO_STREAM_URL || 'https://example.com/veo-stream',

  // Server port for local control
  port: process.env.PORT || 3000,

  // Optional: Cloud service URL for remote control (legacy Socket.IO)
  cloudUrl: process.env.CLOUD_URL || 'http://localhost:4000',

  // Optional: Device identifier
  deviceId: process.env.DEVICE_ID || 'raspberry-pi-001',

  // Azure Table Storage configuration (recommended for cloud interaction)
  azure: {
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
    tableName: process.env.AZURE_TABLE_NAME || 'veoDongleStreams',
    enabled: process.env.AZURE_STORAGE_ENABLED === 'true' || false,
    pollInterval: parseInt(process.env.AZURE_POLL_INTERVAL) || 30000, // 30 seconds
    retryAttempts: parseInt(process.env.AZURE_RETRY_ATTEMPTS) || 3
  },

  // Viewport dimensions (set to your display resolution)
  viewport: {
    width: parseInt(process.env.DISPLAY_WIDTH) || 1920,
    height: parseInt(process.env.DISPLAY_HEIGHT) || 1080
  },

  // Login configuration (if authentication is required)
  login: {
    url: process.env.LOGIN_URL || 'https://live.veo.co/login',
    enabled: process.env.LOGIN_ENABLED === 'true' || false
  },

  // Button coordinates for UI interaction (customize for your stream interface)
  coordinates: {
    click: { x: 100, y: 100 },
    fullscreen: { x: 1765, y: 1045 },
    playback: { x: 45, y: 1052 }
  },

  // Chromium launch options optimized for Raspberry Pi
  chromium: {
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
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      // Additional Raspberry Pi optimizations
      '--max-gum-fps=30',
      '--use-fake-ui-for-media-stream',
      '--disable-extensions-http-throttling',
      '--disable-ipc-flooding-protection'
    ]
  }
};

