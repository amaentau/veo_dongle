const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execPromise = util.promisify(exec);

const express = require('express');

class ProvisioningManager {
  constructor(app, port) {
    this.app = app;
    this.port = port || 3000;
    this.hotspotName = 'VeoHotspot';
    this.ssid = 'VeoSetup';
    this.password = 'veo12345';
  }

  async start() {
    console.log('🚀 Starting Provisioning Mode...');

    // Ensure middleware is set up for parsing JSON bodies
    this.app.use(express.json());
    
    // 1. Setup Routes (do this first so server can start listening)
    this.setupRoutes();

    // 2. Setup Hotspot (run in background to not block server startup)
    this.setupHotspot().catch(e => {
      console.error('⚠️ Hotspot setup encountered an issue:', e.message);
    });

    console.log(`✅ Provisioning routes configured. Web server will start shortly.`);
    console.log(`   Connect to WiFi "${this.ssid}" and navigate to http://10.42.0.1:${this.port}`);
  }

  async setupHotspot() {
    console.log('📡 Configuring Hotspot...');
    
    // Check if connection exists
    try {
      await execPromise(`nmcli connection show "${this.hotspotName}"`);
      console.log('   Hotspot connection profile exists.');
    } catch (e) {
      console.log('   Creating hotspot connection profile...');
      await execPromise(`sudo nmcli con add type wifi ifname wlan0 con-name "${this.hotspotName}" autoconnect yes ssid "${this.ssid}"`);
      await execPromise(`sudo nmcli con modify "${this.hotspotName}" 802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared`);
      await execPromise(`sudo nmcli con modify "${this.hotspotName}" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "${this.password}"`);
    }

    console.log('   Activating hotspot...');
    // We might need to disconnect other wifi first? NetworkManager usually handles priority or one connection per interface.
    try {
      await execPromise(`sudo nmcli con up "${this.hotspotName}"`);
      console.log('✅ Hotspot active');
    } catch (e) {
      console.warn('⚠️ Failed to activate hotspot (might be active already or interface busy):', e.message.trim());
    }
  }

  setupRoutes() {
    console.log('🛠️ Setting up provisioning routes...');
    
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'provisioning.html'));
    });

    this.app.get('/provisioning/wifi-scan', async (req, res) => {
      try {
        const networks = await this.scanWifiNetworks();
        res.json(networks);
      } catch (e) {
        console.error('Wifi scan failed:', e);
        res.json([]); // Return empty list on failure rather than 500
      }
    });

    this.app.post('/provisioning/save', async (req, res) => {
      try {
        console.log('📥 Received configuration data');
        await this.handleSave(req.body);
        res.json({ success: true });
        
        // Restart
        setTimeout(async () => {
          console.log('🔄 Configuration saved. Cleaning up hotspot and restarting system...');
          await this.cleanupHotspot();
          // Exit process; systemd (restart=always) will relaunch us.
          // With config present, we will start in normal mode.
          process.exit(0);
        }, 2000);
      } catch (e) {
        console.error('❌ Save failed:', e);
        res.status(500).json({ error: e.message });
      }
    });
  }

  async scanWifiNetworks() {
    try {
      // Use nmcli to list networks in terse format with specific fields
      // -t: terse (machine readable, : separated)
      // -f: fields
      const { stdout } = await execPromise('nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list');
      
      const networks = [];
      const seen = new Set();
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // Simple parse assuming standard SSIDs (escaping logic omitted for simplicity as typical SSIDs don't have :)
        // Real nmcli -t escapes colons with backslash.
        // A robust split would be needed for complex SSIDs.
        // Quick workaround: Use a non-regex split that respects escaping if needed, 
        // but for now simple split is likely 99% sufficient for typical setup scenarios.
        const parts = line.split(/(?<!\\):/); 
        
        let ssid = parts[0] ? parts[0].replace(/\\:/g, ':') : '';
        const signal = parts[1] ? parseInt(parts[1]) : 0;
        const security = parts[2] || '';

        ssid = ssid.trim();
        if (!ssid) continue;

        // Deduplicate, keeping strongest signal
        if (seen.has(ssid)) continue;
        
        seen.add(ssid);
        networks.push({ ssid, signal, security });
      }

      // Sort by signal strength
      return networks.sort((a, b) => b.signal - a.signal);
    } catch (e) {
      console.warn('Scan command failed:', e.message);
      return [];
    }
  }

  async cleanupHotspot() {
    try {
      console.log('🧹 Removing Hotspot profile...');
      // We use a timeout to ensure we don't hang if nmcli is unresponsive
      const cmd = `sudo nmcli connection delete "${this.hotspotName}"`;
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));
      await Promise.race([execPromise(cmd), timeoutPromise]);
      console.log('✅ Hotspot profile removed');
    } catch (e) {
      console.warn('⚠️ Failed to remove hotspot profile (non-fatal):', e.message);
    }
  }

  async handleSave(data) {
    // 1. Save credentials.json
    if (data.email && data.password) {
      const credentials = {
        email: data.email,
        password: data.password
      };
      fs.writeFileSync(path.join(__dirname, '..', 'credentials.json'), JSON.stringify(credentials, null, 2));
      console.log('💾 Saved credentials.json');
    }

    // 2. Save config.json
    const configPath = path.join(__dirname, '..', 'config.json');
    let config = {};

    // Try to load existing config
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('📂 Loaded existing configuration to preserve settings');
      }
    } catch (e) {
      console.warn('⚠️ Could not load existing config:', e.message);
    }

    // Update simple fields (preserving existing if not provided)
    if (data.deviceId) config.deviceId = data.deviceId;
    if (!config.deviceId) config.deviceId = `raspberry-pi-${Date.now()}`;

    // Ensure nested objects exist
    config.azure = config.azure || {};
    if (data.bbsUrl) config.azure.bbsUrl = data.bbsUrl;
    if (!config.azure.bbsUrl) config.azure.bbsUrl = "https://bbs-web-123.azurewebsites.net/";

    config.display = config.display || {};
    if (!config.display.preferredMode) config.display.preferredMode = "auto";
    if (!config.display.modes) config.display.modes = ["3840x2160", "1920x1080", "1280x720"];

    config.viewport = config.viewport || {};
    if (!config.viewport.width) config.viewport.width = 1920;
    if (!config.viewport.height) config.viewport.height = 1080;

    // Handle Coordinates
    const defaults = {
      1280: { play: { x: 63, y: 681 }, fullscreen: { x: 1136, y: 678 } },
      1920: { play: { x: 87, y: 1032 }, fullscreen: { x: 1771, y: 1032 } },
      3840: { play: { x: 114, y: 2124 }, fullscreen: { x: 3643, y: 2122 } }
    };

    config.coordinates = config.coordinates || {};

    // 1. Ensure defaults exist for any missing resolution
    for (const [width, def] of Object.entries(defaults)) {
      if (!config.coordinates[width]) {
        console.log(`📍 Initializing default coordinates for ${width}px`);
        config.coordinates[width] = {
          play: { ...def.play },
          fullscreen: { ...def.fullscreen },
          baseWidth: parseInt(width)
        };
      }
    }

    // 2. Apply user updates from request (Advanced UI)
    // Expected format: playX_1920, playY_1920, etc.
    const resolutions = [1280, 1920, 3840];
    let coordsUpdated = false;

    resolutions.forEach(res => {
      const px = data[`playX_${res}`];
      const py = data[`playY_${res}`];
      const fx = data[`fullscreenX_${res}`];
      const fy = data[`fullscreenY_${res}`];

      // Only update if value is provided and non-empty
      if ((px !== undefined && px !== '') || 
          (py !== undefined && py !== '') || 
          (fx !== undefined && fx !== '') || 
          (fy !== undefined && fy !== '')) {
        
        coordsUpdated = true;
        const target = config.coordinates[res]; // Guaranteed to exist by step 1
        
        if (px !== undefined && px !== '') target.play.x = parseInt(px);
        if (py !== undefined && py !== '') target.play.y = parseInt(py);
        if (fx !== undefined && fx !== '') target.fullscreen.x = parseInt(fx);
        if (fy !== undefined && fy !== '') target.fullscreen.y = parseInt(fy);
        
        console.log(`📍 Updated custom coordinates for ${res}px`);
      }
    });

    if (!coordsUpdated) {
      console.log('📍 No manual coordinate adjustments provided, keeping existing/defaults');
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('💾 Saved config.json');

    // 3. Configure WiFi
    // Support new 'wifiNetworks' array or legacy single fields
    let networks = [];
    if (Array.isArray(data.wifiNetworks)) {
      networks = data.wifiNetworks.filter(n => n.ssid);
    } else if (data.wifiSsid) {
      networks.push({ ssid: data.wifiSsid, password: data.wifiPassword });
    }

    if (networks.length > 0) {
      console.log(`📶 Configuring ${networks.length} WiFi networks...`);
      
      const execWithTimeout = async (cmd, timeoutMs = 5000) => {
        return Promise.race([
            execPromise(cmd),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Command timed out: ${cmd}`)), timeoutMs))
        ]);
      };

      const escapeShellArg = (arg) => `'${String(arg).replace(/'/g, "'\\''")}'`;

      for (const net of networks) {
        if (!net.ssid) continue;
        console.log(`   Processing network: ${net.ssid}`);
        
        try {
          const safeSsid = escapeShellArg(net.ssid);
          const safePass = net.password ? escapeShellArg(net.password) : '';
          
          // Delete existing profile with same name to ensure clean state
          try { await execWithTimeout(`sudo nmcli connection delete ${safeSsid}`); } catch(_) {}

          let cmd = `sudo nmcli con add type wifi ifname wlan0 con-name ${safeSsid} ssid ${safeSsid}`;
          if (safePass) {
             cmd += ` wifi-sec.key-mgmt wpa-psk wifi-sec.psk ${safePass}`;
          }

          // Log safely
          console.log(`   Executing: ${cmd.replace(/psk '.*?'/, "psk '***'")}`);
          
          // Add profile (10s timeout)
          await execWithTimeout(cmd, 10000);
          
          // Enable autoconnect
          await execWithTimeout(`sudo nmcli con modify ${safeSsid} connection.autoconnect yes`);
          
          // Set priority? We could set priority based on order in list (higher number = higher priority)
          // nmcli connection modify ID connection.autoconnect-priority 10
          
        } catch (e) {
          console.error(`   ⚠️ Failed to configure ${net.ssid}:`, e.message);
        }
      }
      console.log('✅ WiFi configuration complete');
    }
  }
}

module.exports = ProvisioningManager;
