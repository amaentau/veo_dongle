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
    // No password for simplified setup
    this.ipAddress = '10.42.0.1';
    this.subnetMask = '255.255.255.0';
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

    // 2. Start Captive Portal Services (DNS/DHCP via dnsmasq)
    try {
        await this.startCaptivePortalServices();
    } catch (e) {
        console.error('⚠️ Failed to start captive portal services:', e.message);
    }

    // 3. Setup Routes
    this.setupRoutes();

    console.log(`✅ Provisioning server ready. Connect to WiFi "${this.ssid}" (No Password) and wait for the sign-in page.`);
  }

  async setupHotspot() {
    console.log('📡 Configuring Hotspot (Open)...');
    
    // Check if connection exists
    let exists = false;
    try {
      await execPromise(`nmcli connection show "${this.hotspotName}"`);
      exists = true;
      // Check if it is configured correctly (manual IP, no security)
      // Ideally we delete and recreate to be sure, or check details. 
      // Simpler to recreate if we changed logic.
      console.log('   Hotspot connection profile exists. Recreating to ensure settings...');
      await execPromise(`sudo nmcli connection delete "${this.hotspotName}"`);
      exists = false;
    } catch (e) {
      // Doesn't exist
    }

    if (!exists) {
      console.log('   Creating hotspot connection profile...');
      // Create with manual IP to avoid conflict with default shared mode (which runs its own dnsmasq)
      // We want to run our own dnsmasq for Captive Portal DNS spoofing.
      await execPromise(`sudo nmcli con add type wifi ifname wlan0 con-name "${this.hotspotName}" autoconnect yes ssid "${this.ssid}"`);
      await execPromise(`sudo nmcli con modify "${this.hotspotName}" 802-11-wireless.mode ap 802-11-wireless.band bg`);
      // Set manual IP
      await execPromise(`sudo nmcli con modify "${this.hotspotName}" ipv4.method manual ipv4.addresses ${this.ipAddress}/24`);
      // No security (Open)
      await execPromise(`sudo nmcli con modify "${this.hotspotName}" wifi-sec.key-mgmt none`);
    }

    console.log('   Activating hotspot...');
    try {
      await execPromise(`sudo nmcli con up "${this.hotspotName}"`);
      console.log('✅ Hotspot active');
    } catch (e) {
      console.warn('⚠️ Failed to activate hotspot:', e.message.trim());
    }
  }

  async startCaptivePortalServices() {
      console.log('🕸️ Starting Captive Portal Services (dnsmasq)...');

      // Stop any existing dnsmasq to free port 53
      try {
          await execPromise('sudo killall dnsmasq');
      } catch (_) {}

      // Create config file
      const configFile = '/tmp/veo-dnsmasq.conf';
      const config = `
interface=wlan0
bind-interfaces
# DHCP Settings
dhcp-range=10.42.0.10,10.42.0.254,12h
dhcp-option=3,${this.ipAddress} # Gateway
dhcp-option=6,${this.ipAddress} # DNS
# DNS Spoofing (Captive Portal)
address=/#/${this.ipAddress}
# Logging
log-queries
log-dhcp
`;
      fs.writeFileSync(configFile, config);

      // Start dnsmasq
      await execPromise(`sudo dnsmasq -C ${configFile}`);
      console.log('✅ Captive Portal DNS/DHCP started');
  }

  setupRoutes() {
    console.log('🛠️ Setting up provisioning routes...');
    
    // Helper to serve the page
    const servePage = (res) => {
        res.sendFile(path.join(__dirname, 'public', 'provisioning.html'));
    };

    // Main entry point
    this.app.get('/', (req, res) => servePage(res));
    
    // Captive Portal Detection URLs (Android, iOS, Windows)
    this.app.get('/generate_204', (req, res) => servePage(res));
    this.app.get('/ncsi.txt', (req, res) => servePage(res));
    this.app.get('/hotspot-detect.html', (req, res) => servePage(res));
    this.app.get('/canonical.html', (req, res) => servePage(res));
    this.app.get('/success.txt', (req, res) => servePage(res));

    // Catch-all for random domains (since we spoof DNS)
    this.app.use((req, res, next) => {
        // If it's an API call or static asset, let it pass (managed by other routes/static middleware)
        // But if it's a random GET request (likely a CP check), redirect to root
        // Note: The static middleware is already setup in index.js BEFORE this class is used? 
        // index.js calls setupServer() which sets static.
        // So existing files will be served.
        // We just need to catch 404s that are actually CP checks.
        
        if (req.method === 'GET') {
            // Redirect everything else to root
            return res.redirect('/');
        }
        next();
    });


    this.app.post('/provisioning/save', async (req, res) => {
      try {
        console.log('📥 Received configuration data');
        await this.handleSave(req.body);
        res.json({ success: true });
        
        // Restart
        setTimeout(() => {
          console.log('🔄 Configuration saved. Restarting system...');
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
    const baseWidth = 1920;
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
        const safeSsid = data.wifiSsid.replace(/"/g, '\\"');
        const safePass = data.wifiPassword ? data.wifiPassword.replace(/"/g, '\\"') : '';
        
        try { await execPromise(`sudo nmcli connection delete "${safeSsid}"`); } catch(_) {}
        
        let cmd = `sudo nmcli con add type wifi ifname wlan0 con-name "${safeSsid}" ssid "${safeSsid}"`;
        if (safePass) {
             cmd += ` wifi-sec.key-mgmt wpa-psk wifi-sec.psk "${safePass}"`;
        }
        await execPromise(cmd);
        await execPromise(`sudo nmcli con modify "${safeSsid}" connection.autoconnect yes`);
        
        console.log('✅ WiFi profile created (will connect on restart)');
      } catch (e) {
        console.error('⚠️ WiFi profile creation error:', e.message);
        throw new Error(`Failed to configure WiFi: ${e.message}`);
      }
    }
  }
}

module.exports = ProvisioningManager;
