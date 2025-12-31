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
    this.hotspotName = 'EspaHotspot';
    this.ssid = 'EspaSetup';
    this.password = 'espa12345';
  }

  async isHotspotActive() {
    try {
      const { stdout } = await execPromise('nmcli -t -f NAME,TYPE connection show --active');
      return stdout
        .split('\n')
        .some(line => line.trim() === `${this.hotspotName}:802-11-wireless`);
    } catch (_) {
      return false;
    }
  }

  async cleanupCaptivePortalRules() {
    try {
      const rule = `-i wlan0 -p tcp --dport 80 -j REDIRECT --to-port ${this.port}`;
      await execPromise(`sudo sh -c "while iptables -t nat -C PREROUTING ${rule} 2>/dev/null; do iptables -t nat -D PREROUTING ${rule}; done"`);
    } catch (_) {
      // non-fatal
    }
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

    // 3. Setup Captive Portal Redirect (Port 80 -> 3000)
    this.setupCaptivePortal().catch(e => {
      console.warn('⚠️ Captive portal redirect failed (non-fatal):', e.message);
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
      // IMPORTANT: autoconnect MUST be 'no' so it doesn't interfere with normal WiFi on boot
      await execPromise(`sudo nmcli con add type wifi ifname wlan0 con-name "${this.hotspotName}" autoconnect no ssid "${this.ssid}"`);
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

  async setupCaptivePortal() {
    console.log('🪤 Configuring Captive Portal redirection...');
    // Redirect TCP port 80 on wlan0 to our port (default 3000)
    // This allows devices to detect the portal when checking connectivity (e.g. generate_204)
    try {
      // Make it idempotent: add the rule only if it doesn't already exist.
      // Use -I to ensure it takes effect even if other PREROUTING rules exist.
      const rule = `-i wlan0 -p tcp --dport 80 -j REDIRECT --to-port ${this.port}`;
      await execPromise(`sudo sh -c "iptables -t nat -C PREROUTING ${rule} 2>/dev/null || iptables -t nat -I PREROUTING 1 ${rule}"`);
      console.log('✅ Captive Portal redirection active (Port 80 -> ' + this.port + ')');
    } catch (e) {
      // If sudo iptables fails (permission), we can't do much.
      throw e;
    }
  }

  setupRoutes() {
    console.log('🛠️ Setting up provisioning routes...');
    
    // Captive Portal Detection Helpers
    // Android/Chrome
    this.app.get('/generate_204', (req, res) => res.redirect('/'));
    this.app.get('/gen_204', (req, res) => res.redirect('/'));
    // Apple
    this.app.get('/hotspot-detect.html', (req, res) => res.redirect('/'));
    // Microsoft
    this.app.get('/ncsi.txt', (req, res) => res.redirect('/'));

    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'provisioning.html'));
    });

    this.app.get('/provisioning/current-config', (req, res) => {
      // Helper to safely load JSON
      const loadJson = (p) => {
        try {
          if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) { console.warn(`Failed to read ${p}:`, e.message); }
        return {};
      };

      const configPath = path.join(__dirname, '..', 'config.json');
      const credPath = path.join(__dirname, '..', 'credentials.json');
      const idPath = path.join(__dirname, '..', '.device-id');
      
      const config = loadJson(configPath);
      const creds = loadJson(credPath);

      // 1. Try to read existing burned-in ID from isolated file
      let deviceId = '';
      if (fs.existsSync(idPath)) {
        try {
          const content = fs.readFileSync(idPath, 'utf8');
          const match = content.match(/ID:\s*([a-zA-Z0-9-]+)/);
          if (match && match[1]) deviceId = match[1];
        } catch (e) {}
      }
      
      let configuredWifi = [];
      try {
        // List existing wifi connection profiles
        const { stdout } = require('child_process').execSync('nmcli -t -f NAME,TYPE connection show');
        configuredWifi = stdout.split('\n')
          .filter(line => line.includes(':802-11-wireless'))
          .map(line => line.split(':')[0])
          .filter(name => name !== 'EspaHotspot' && name !== 'VeoHotspot'); // Exclude our hotspots
      } catch (e) {
        console.warn('Failed to list wifi connections:', e.message);
      }

      res.json({
        email: creds.email || '',
        password: creds.password || '',
        deviceId: deviceId,
        friendlyName: config.friendlyName || '',
        wifiNetworks: configuredWifi,
        headlessOk: fs.existsSync(path.join(__dirname, '..', '.headless_ok'))
      });
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
        
        // Restart after a longer delay to ensure the browser received the success response
        // and the user had a moment to read it before the hotspot disappears.
        setTimeout(async () => {
          console.log('🔄 Configuration saved. Cleaning up hotspot and restarting system...');
          await this.cleanupHotspot();
          // Exit process; systemd (restart=always) will relaunch us.
          process.exit(0);
        }, 5000);
      } catch (e) {
        console.error('❌ Save failed:', e);
        res.status(500).json({ error: e.message });
      }
    });

    // Catch-all for Captive Portal (redirect unknown routes to /)
    // Only do this after specific routes are defined
    this.app.use((req, res, next) => {
       // If it looks like a captive portal check or unknown host, redirect
       // Simple approach: Redirect everything else to root
       res.redirect('/');
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

        // Filter out our own hotspot SSID to avoid confusion
        if (ssid === this.ssid) continue;

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
      console.log('🧹 Removing Captive Portal rules...');
      await this.cleanupCaptivePortalRules();

      // Check if hotspot connection exists before trying to bring it down/delete
      let hotspotExists = false;
      try {
        const { stdout } = await execPromise(`nmcli connection show "${this.hotspotName}"`);
        hotspotExists = !!stdout;
      } catch (_) {}

      if (hotspotExists) {
        console.log('🧹 Disconnecting Hotspot...');
        try {
          await execPromise(`sudo nmcli connection down "${this.hotspotName}"`);
        } catch (_) {}

        // Keep the hotspot profile (autoconnect=no) to avoid churn and reduce risk of NM flapping.
        // Next time provisioning starts, we can simply `nmcli con up` it again.
        console.log('✅ Hotspot disconnected (profile kept)');
      } else {
        console.log('ℹ️ Hotspot profile already gone.');
      }
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

    // If still no deviceId, we'll let index.js generate one on next boot.
    // We NO LONGER save deviceId into config.json to keep it clean.

    // Ensure nested objects exist
    config.azure = config.azure || {};
    if (data.bbsUrl) config.azure.bbsUrl = data.bbsUrl;
    if (!config.azure.bbsUrl) config.azure.bbsUrl = "https://espa-tv-app.azurewebsites.net";

    if (data.friendlyName) config.friendlyName = data.friendlyName;

    config.display = config.display || {};
    if (!config.display.preferredMode) config.display.preferredMode = "auto";
    if (!config.display.modes) config.display.modes = ["3840x2160", "1920x1080", "1280x720"];

    config.viewport = config.viewport || {};
    if (!config.viewport.width) config.viewport.width = 1920;
    if (!config.viewport.height) config.viewport.height = 1080;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('💾 Saved config.json');

    // 2.5 Handle Headless Override
    const headlessPath = path.join(__dirname, '..', '.headless_ok');
    if (data.headlessOk === true) {
      fs.writeFileSync(headlessPath, 'true');
      console.log('💾 Enabled headless mode (.headless_ok)');
    } else {
      if (fs.existsSync(headlessPath)) {
        fs.unlinkSync(headlessPath);
        console.log('🧹 Disabled headless mode (removed .headless_ok)');
      }
    }

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
      const sanitizeName = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
      const preferredOrder = [];

      for (const net of networks) {
        if (!net.ssid) continue;
        console.log(`   Processing network: ${net.ssid}`);
        
        try {
          const safeSsid = escapeShellArg(net.ssid);
          const safePass = net.password ? escapeShellArg(net.password) : '';

          // Use a deterministic, app-owned connection name so we don't delete/override the user's existing profiles.
          const conName = `EspaWiFi-${sanitizeName(net.ssid)}`;
          const safeConName = escapeShellArg(conName);

          // Create or update profile
          let exists = false;
          try {
            await execWithTimeout(`nmcli -t -f NAME connection show ${safeConName}`, 3000);
            exists = true;
          } catch (_) {}

          if (!exists) {
            let addCmd = `sudo nmcli con add type wifi ifname wlan0 con-name ${safeConName} ssid ${safeSsid}`;
            if (safePass) {
              addCmd += ` wifi-sec.key-mgmt wpa-psk wifi-sec.psk ${safePass}`;
            }
            console.log(`   Creating profile: ${addCmd.replace(/psk '.*?'/, "psk '***'")}`);
            await execWithTimeout(addCmd, 10000);
          } else if (safePass) {
            console.log(`   Updating password for profile ${conName}`);
            await execWithTimeout(`sudo nmcli con modify ${safeConName} wifi-sec.key-mgmt wpa-psk wifi-sec.psk ${safePass}`, 5000);
          }

          // Keep changes minimal; let NetworkManager defaults handle DHCP/IPv6 unless user config says otherwise.
          const modCmd = [
            `sudo nmcli con modify ${safeConName}`,
            `connection.autoconnect yes`,
            `connection.autoconnect-priority 100`,
            `ipv4.method auto`,
            `ipv6.method auto`,
          ].join(' ');
          await execWithTimeout(modCmd, 5000);

          preferredOrder.push({ ssid: net.ssid, conName });
          console.log(`✅ Configured ${net.ssid} successfully (profile: ${conName})`);
          
        } catch (e) {
          console.error(`   ⚠️ Failed to configure ${net.ssid}:`, e.message);
        }
      }
      console.log('✅ WiFi configuration complete');

      // Best-effort: bring hotspot down and try to connect immediately (reduces "it never comes back" cases).
      try {
        await this.cleanupHotspot();
      } catch (_) {}

      for (const item of preferredOrder) {
        try {
          console.log(`📶 Attempting to connect to ${item.ssid}...`);
          await execWithTimeout(`sudo nmcli con up ${escapeShellArg(item.conName)}`, 20000);
          console.log(`✅ Connected to ${item.ssid}`);
          break;
        } catch (e) {
          console.warn(`⚠️ Connect attempt failed for ${item.ssid}:`, e.message);
        }
      }
    }
  }
}

module.exports = ProvisioningManager;
