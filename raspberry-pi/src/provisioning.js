const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execPromise = util.promisify(exec);

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
    
    // 1. Setup Hotspot
    try {
      await this.setupHotspot();
    } catch (e) {
      console.error('⚠️ Failed to setup hotspot:', e.message);
      console.log('Continuing hoping for existing connection...');
    }

    // 2. Setup Routes
    this.setupRoutes();

    console.log(`✅ Provisioning server ready. Connect to WiFi "${this.ssid}" and go to http://10.42.0.1:${this.port} (or the device IP)`);
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

    this.app.post('/provisioning/save', async (req, res) => {
      try {
        console.log('📥 Received configuration data');
        await this.handleSave(req.body);
        res.json({ success: true });
        
        // Restart
        setTimeout(() => {
          console.log('🔄 Configuration saved. Restarting system...');
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
    // Construct config object matching application structure
    const baseWidth = 1920;
    
    // Defaults
    const playX = data.playX !== undefined && data.playX !== null && !isNaN(data.playX) ? parseInt(data.playX) : 960;
    const playY = data.playY !== undefined && data.playY !== null && !isNaN(data.playY) ? parseInt(data.playY) : 540;
    const fsX = data.fullscreenX !== undefined && data.fullscreenX !== null && !isNaN(data.fullscreenX) ? parseInt(data.fullscreenX) : 1800;
    const fsY = data.fullscreenY !== undefined && data.fullscreenY !== null && !isNaN(data.fullscreenY) ? parseInt(data.fullscreenY) : 1000;

    const coords = {
        [baseWidth]: {
            play: { x: playX, y: playY },
            fullscreen: { x: fsX, y: fsY },
            baseWidth: baseWidth
        }
    };

    const config = {
      deviceId: data.deviceId || `raspberry-pi-${Date.now()}`,
      azure: {
        bbsUrl: data.bbsUrl || "https://veo-bbs.azurewebsites.net/api"
      },
      display: {
        preferredMode: "auto",
        modes: ["3840x2160", "1920x1080", "1280x720"]
      },
      coordinates: coords,
      viewport: { width: 1920, height: 1080 }
    };

    fs.writeFileSync(path.join(__dirname, '..', 'config.json'), JSON.stringify(config, null, 2));
    console.log('💾 Saved config.json');

    // 3. Configure WiFi
    if (data.wifiSsid) {
      console.log(`📶 Configuring WiFi Profile: ${data.wifiSsid}`);
      try {
        // Create connection profile without activating immediately (to preserve Hotspot for response)
        // Delete existing if any
        const safeSsid = data.wifiSsid.replace(/"/g, '\\"');
        const safePass = data.wifiPassword ? data.wifiPassword.replace(/"/g, '\\"') : '';
        
        // Check/Delete existing
        try { await execPromise(`sudo nmcli connection delete "${safeSsid}"`); } catch(_) {}
        
        // Add new profile
        // Note: 'nmcli con add' does not disconnect current connection usually
        let cmd = `sudo nmcli con add type wifi ifname wlan0 con-name "${safeSsid}" ssid "${safeSsid}"`;
        if (safePass) {
             cmd += ` wifi-sec.key-mgmt wpa-psk wifi-sec.psk "${safePass}"`;
        }
        await execPromise(cmd);
        
        // Ensure it has autoconnect enabled
        await execPromise(`sudo nmcli con modify "${safeSsid}" connection.autoconnect yes`);
        
        console.log('✅ WiFi profile created (will connect on restart)');
      } catch (e) {
        console.error('⚠️ WiFi profile creation error:', e.message);
        // We throw here so UI knows saving failed?
        // Yes, if we can't save wifi config, user should know.
        throw new Error(`Failed to configure WiFi: ${e.message}`);
      }
    }
  }
}

module.exports = ProvisioningManager;

