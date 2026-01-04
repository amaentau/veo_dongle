#!/usr/bin/env node

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ProvisioningManager = require('./provisioning');
const CloudService = require('./cloud-service');
const HDMIMonitor = require('./hdmi-monitor');
const ProvisioningStateManager = require('./provisioning-state');
const IoTDeviceService = require('./iot-device-service');
const ConnectivityManager = require('./connectivity-manager');
const PlayerController = require('./player-controller');
require('dotenv').config();

const PlayerState = {
  BOOTING: 'BOOTING',
  PROVISIONING: 'PROVISIONING',
  CONNECTING: 'CONNECTING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  ERROR: 'ERROR'
};

class EspaTvPlayer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    
    this._state = PlayerState.BOOTING;
    
    // Config and Identity
    this.config = this.loadJsonConfig('config.json');
    this.credentials = this.loadJsonConfig('credentials.json');
    this.deviceId = this.getPersistentDeviceId();
    this.port = this.config.port || process.env.PORT || 3000;

    // Components
    this.hdmiMonitor = new HDMIMonitor();
    this.stateManager = new ProvisioningStateManager();
    this.connectivity = new ConnectivityManager(this.config, this.deviceId, this.credentials);
    this.player = new PlayerController(this.config, this.deviceId, this.credentials);
    this.cloudService = new CloudService(this.config, this.deviceId);
    this.iotService = null;

    this.streamUrl = null;
  }

  get state() { return this._state; }
  set state(newState) {
    console.log(`🔄 State Transition: ${this._state} → ${newState}`);
    this._state = newState;
  }

  loadJsonConfig(filename) {
    const p = path.join(__dirname, '..', filename);
    if (!fs.existsSync(p)) return {};
    try {
      const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').trim();
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`⚠️ Failed to parse ${filename}:`, e.message);
      return {};
    }
  }

  getPersistentDeviceId() {
    const idPath = path.join(__dirname, '..', '.device-id');
    if (fs.existsSync(idPath)) {
      const content = fs.readFileSync(idPath, 'utf8');
      const match = content.match(/ID:\s*([a-zA-Z0-9-]+)/);
      if (match?.[1]) return match[1];
    }
    const id = `rpi-gen-${Math.random().toString(36).substring(2, 10)}`;
    fs.writeFileSync(idPath, `# DO NOT EDIT\nID: ${id}\n`, 'utf8');
    return id;
  }

  setupServer() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    this.app.get('/health', (req, res) => res.json({ 
      status: 'ok', 
      state: this.state,
      deviceId: this.deviceId 
    }));
    
    this.app.get('/diagnostics', async (req, res) => {
      res.json({
        state: this.state,
        hdmi: await this.hdmiMonitor.getDiagnostics(),
        provisioning: this.stateManager.getState(),
        deviceId: this.deviceId,
        iotConnected: this.iotService?.isConnected || false
      });
    });
  }

  async initialize() {
    try {
      console.log(`🚀 Initializing Espa-TV Player (ID: ${this.deviceId})`);
      
      // 1. Provisioning Check
      const hdmiStatus = await this.hdmiMonitor.checkHDMI();
      const needsProvisioning = !this.config.azure?.bbsUrl || !this.credentials.email || !hdmiStatus.connected;

      this.setupServer();
      this.server.listen(this.port, () => console.log(`🔌 Server active on port ${this.port}`));

      if (needsProvisioning && process.env.IGNORE_PROVISIONING !== 'true') {
        this.state = PlayerState.PROVISIONING;
        return this.startProvisioning('Initial setup or missing HDMI');
      }

      // 2. Start Player (Splash Screen)
      await this.player.launchBrowser();
      await this.player.page.goto(`http://127.0.0.1:${this.port}/splash.html`);

      // 3. Connectivity & Cloud Sync
      this.state = PlayerState.CONNECTING;
      const online = await this.connectivity.waitForInternet(msg => this.updateSplash(msg));
      if (!online) {
        this.state = PlayerState.ERROR;
        console.error('❌ Failed to establish internet connection.');
        return;
      }

      await this.connectivity.announceToCloud(msg => this.updateSplash(msg));
      await this.cloudService.initialize();
      
    const bbsKey = process.env.BBS_KEY || this.deviceId;
    this.streamUrl = await this.connectivity.fetchBbsStreamUrlOnce(bbsKey);
    this.player.cloudCoordinates = await this.cloudService.getCoordinates();

    // 4. Set Ready State before IoT Handshake
    this.state = PlayerState.READY;
    await this.initializeIoTHub();

    // 5. Start Playback
    if (this.streamUrl) {
      await this.player.goToStream(this.streamUrl, true); // Initial boot: true
      this.state = PlayerState.PLAYING;
    } else {
      console.warn('⚠️ No stream URL found. Waiting for commands.');
      await this.updateSplash('Odotetaan lähetystä...');
    }
    } catch (error) {
      this.state = PlayerState.ERROR;
      throw error;
    }
  }

  async initializeIoTHub() {
    const iotConnection = await this.cloudService.getIoTHubConnectionString();
    if (!iotConnection) return;

    this.iotService = new IoTDeviceService(this.deviceId, iotConnection.hubName, iotConnection.sasToken, iotConnection.connectionString);
    this.iotService.onCommand((cmd, payload) => this.handleIoTCommand(cmd, payload));
    await this.iotService.connect();
  }

  async handleIoTCommand(command, payload) {
    console.log(`🎮 IoT Command Received: ${command} (State: ${this.state})`);

    // Gate commands based on state
    if (this.state === PlayerState.BOOTING || this.state === PlayerState.CONNECTING) {
      return { success: false, error: 'Device is still booting or connecting' };
    }
    
    if (this.state === PlayerState.PROVISIONING) {
      return { success: false, error: 'Device is in provisioning mode' };
    }

    try {
      switch (command) {
        case 'play': 
          await this.player.playStream(); 
          this.state = PlayerState.PLAYING;
          return { success: true };
        case 'pause': 
          await this.player.pauseStream(); 
          this.state = PlayerState.READY;
          return { success: true };
        case 'fullscreen': 
          await this.player.enterFullscreen(); 
          return { success: true };
        case 'restart': 
          setTimeout(() => process.exit(0), 1000); 
          return { success: true, message: 'Device rebooting' };
        case 'status':
          return { success: true, state: this.state, streamUrl: this.streamUrl };
        default: 
          return { success: false, error: 'Unknown command' };
      }
    } catch (error) {
      console.error(`❌ IoT command ${command} failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async updateSplash(message) {
    if (this.player.page) {
      await this.player.page.evaluate(m => window.updateStatus && window.updateStatus(m), message).catch(() => {});
    }
  }

  async startProvisioning(reason) {
    console.log(`🛠️ Entering Provisioning Mode: ${reason}`);
    this.isProvisioning = true;
    const pm = new ProvisioningManager(this.app, this.port, this.stateManager);
    await pm.start();
  }

  async stop() {
    if (this.iotService) await this.iotService.disconnect();
    await this.player.close();
    this.server.close();
  }
}

// Global instance for signal handling
const player = new EspaTvPlayer();
player.initialize().catch(err => {
  console.error('💥 Fatal Startup Error:', err);
  process.exit(1);
});

process.on('SIGINT', () => player.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => player.stop().then(() => process.exit(0)));
