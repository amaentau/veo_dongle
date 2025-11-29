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
    this.ipAddress = '10.42.0.1';
  }

  async start() {
    console.log('🚀 Starting Provisioning Mode (Simplified)...');
    
    try {
      await this.setupHotspot();
      await this.startDnsmasq();
      this.setupRoutes();
      console.log(`✅ Provisioning ready. Connect to "${this.ssid}" and go to http://${this.ipAddress}:${this.port}`);
    } catch (e) {
      console.error('❌ Provisioning setup failed:', e);
      // Do not exit, so we can inspect the state
    }
  }

  async setupHotspot() {
    console.log('📡 Configuring Hotspot...');

    // Ensure Wireless is unblocked
    try { await execPromise('sudo rfkill unblock wifi'); } catch(_) {}

    // Clean up old connection
    try { await execPromise(`sudo nmcli connection delete "${this.hotspotName}"`); } catch(_) {}

    // Create new connection (Open, Manual IP)
    // ipv4.gateway is deliberately omitted to prevent clients from thinking there is internet
    console.log('   Creating connection profile...');
    await execPromise(`sudo nmcli con add type wifi ifname wlan0 con-name "${this.hotspotName}" autoconnect yes ssid "${this.ssid}"`);
    await execPromise(`sudo nmcli con modify "${this.hotspotName}" 802-11-wireless.mode ap 802-11-wireless.band bg 802-11-wireless.channel 1`);
    await execPromise(`sudo nmcli con modify "${this.hotspotName}" ipv4.method manual ipv4.addresses ${this.ipAddress}/24`);
    await execPromise(`sudo nmcli con modify "${this.hotspotName}" wifi-sec.key-mgmt none`);

    // Bring up
    console.log('   Activating hotspot...');
    await execPromise(`sudo nmcli con up "${this.hotspotName}"`);
    console.log('✅ Hotspot active');
  }

  async startDnsmasq() {
    console.log('mw Starting DNS/DHCP (dnsmasq)...');

    // Stop existing
    try { await execPromise('sudo killall dnsmasq'); } catch (_) {}

    const configFile = '/tmp/veo-dnsmasq.conf';
    // Simple config: DHCP + DNS spoofing to self
    const config = `
interface=wlan0
bind-interfaces
dhcp-range=10.42.0.10,10.42.0.254,12h
dhcp-option=3,${this.ipAddress}
dhcp-option=6,${this.ipAddress}
address=/#/${this.ipAddress}
log-queries
log-dhcp
`;
    fs.writeFileSync(configFile, config);

    await execPromise(`sudo dnsmasq -C ${configFile}`);
    console.log('✅ dnsmasq started');
  }

  setupRoutes() {
    // Serve the provisioning page
    const servePage = (res) => res.sendFile(path.join(__dirname, 'public', 'provisioning.html'));

    this.app.get('/', (req, res) => servePage(res));
    
    // Captive portal detection URLs
    const cpRoutes = [
        '/generate_204', '/ncsi.txt', '/hotspot-detect.html', 
        '/canonical.html', '/success.txt', '/library/test/success.html'
    ];
    cpRoutes.forEach(r => this.app.get(r, (req, res) => servePage(res)));

    // Catch-all for other domains (DNS spoofing redirects them to us)
    this.app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/provisioning') && !req.path.includes('.')) {
             return res.redirect('/');
        }
        next();
    });

    // Save handler
    this.app.post('/provisioning/save', async (req, res) => {
      try {
        console.log('📥 Saving config...');
        await this.handleSave(req.body);
        res.json({ success: true });
        setTimeout(() => {
             console.log('🔄 Restarting...');
             process.exit(0); 
        }, 1000);
      } catch (e) {
        console.error('Save error:', e);
        res.status(500).json({ error: e.message });
      }
    });
  }

  async handleSave(data) {
    if (data.email && data.password) {
      fs.writeFileSync(path.join(__dirname, '..', 'credentials.json'), 
        JSON.stringify({ email: data.email, password: data.password }, null, 2));
    }

    // Save config.json (simplified)
    const config = {
      deviceId: data.deviceId || `rpi-${Date.now()}`,
      azure: { bbsUrl: data.bbsUrl || "https://veo-bbs.azurewebsites.net/api" },
      display: { preferredMode: "auto", modes: ["1920x1080"] },
      viewport: { width: 1920, height: 1080 }
    };
    fs.writeFileSync(path.join(__dirname, '..', 'config.json'), JSON.stringify(config, null, 2));

    // Configure WiFi Client Mode (if provided)
    if (data.wifiSsid) {
      console.log(`📶 Switching to Client WiFi: ${data.wifiSsid}`);
      const ssid = data.wifiSsid.replace(/"/g, '\\"');
      const pass = data.wifiPassword ? data.wifiPassword.replace(/"/g, '\\"') : '';
      
      try { await execPromise(`sudo nmcli con delete "${ssid}"`); } catch(_) {}
      
      let cmd = `sudo nmcli con add type wifi ifname wlan0 con-name "${ssid}" ssid "${ssid}"`;
      if (pass) cmd += ` wifi-sec.key-mgmt wpa-psk wifi-sec.psk "${pass}"`;
      
      await execPromise(cmd);
      await execPromise(`sudo nmcli con modify "${ssid}" connection.autoconnect yes`);
    }
  }
}

module.exports = ProvisioningManager;
