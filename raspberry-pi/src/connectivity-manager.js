const { exec } = require('child_process');
const dns = require('dns').promises;
const os = require('os');
const NetworkUtils = require('./network-utils');

/**
 * Manages network and BBS connectivity for the Raspberry Pi
 */
class ConnectivityManager {
  constructor(config, deviceId, credentials) {
    this.config = config;
    this.deviceId = deviceId;
    this.credentials = credentials;
  }

  /**
   * Check basic internet connectivity (IP + DNS only, fast)
   */
  async checkBasicConnectivity() {
    try {
      console.log('🔍 Checking basic network connectivity...');

      const interfaces = os.networkInterfaces();
      let hasIp = false;
      let activeInterfaces = [];

      for (const name of Object.keys(interfaces)) {
        if (name === 'lo' || name === 'docker0') continue;
        const iface = interfaces[name];
        if (!iface) continue;

        let ifaceHasIp = false;
        for (const info of iface) {
          if (!info.internal && (info.family === 'IPv4' || info.family === 'IPv6') && info.address !== '127.0.0.1') {
            ifaceHasIp = true;
            activeInterfaces.push(`${name}: ${info.address}`);
            break;
          }
        }

        if (ifaceHasIp) {
          hasIp = true;
        }
      }

      if (!hasIp) {
        console.log('❌ No IP address assigned to network interfaces');
        return false;
      }

      console.log(`✅ IP addresses found: ${activeInterfaces.join(', ')}`);

      console.log('🔍 Testing DNS resolution...');
      try {
        await Promise.any([
          dns.lookup('google.com'),
          dns.lookup('cloudflare.com')
        ]);
        console.log('✅ DNS resolution working');
        return true;
      } catch (e) {
        console.log(`❌ DNS resolution failed: ${e.message}`);
        return false;
      }
    } catch (e) {
      console.log(`❌ Basic connectivity check error: ${e.message}`);
      return false;
    }
  }

  /**
   * Check full internet connectivity (IP + DNS + BBS required)
   */
  async checkInternet() {
    try {
      if (!(await this.checkBasicConnectivity())) {
        return false;
      }

      if (!this.config.azure?.bbsUrl) {
        console.log('❌ No BBS URL configured - application cannot function without cloud service');
        return false;
      }

      console.log(`🔍 Testing BBS connectivity: ${this.config.azure.bbsUrl}`);

      try {
        const url = new URL(this.config.azure.bbsUrl);
        console.log(`🔍 Resolving BBS domain: ${url.hostname}`);
        await dns.lookup(url.hostname);
        console.log(`✅ BBS domain resolved: ${url.hostname}`);
      } catch (e) {
        console.log(`❌ BBS domain resolution failed: ${e.message}`);
        return false;
      }

      try {
        const response = await NetworkUtils.httpRequest(this.config.azure.bbsUrl, {
          method: 'HEAD',
          headers: {
            'Cache-Control': 'no-cache',
            'User-Agent': 'Espa-TV/1.0'
          }
        }, {
          maxRetries: 8,
          timeoutMs: 30000,
          retryDelayMs: attempt => attempt <= 3 ? 5000 : 2000
        });

        if (response.ok || response.status === 204 || response.status === 302) {
          console.log(`✅ BBS connectivity confirmed (HTTP ${response.status})`);
          return true;
        } else {
          console.log(`⚠️ BBS returned HTTP ${response.status}`);
          return false;
        }
      } catch (e) {
        console.log(`❌ BBS connectivity check failed: ${e.message}`);
        return false;
      }
    } catch (e) {
      console.log(`❌ Network check error: ${e.message}`);
      return false;
    }
  }

  /**
   * Wait for internet connectivity with detailed diagnostics and multi-stage recovery
   */
  async waitForInternet(updateSplash, timeoutMs = 300000, startIntervalMs = 3000) {
    const startTime = Date.now();
    let currentInterval = startIntervalMs;
    let failCount = 0;

    console.log(`🌐 Starting network connectivity check (BBS required, timeout: ${timeoutMs/1000}s)`);
    if (updateSplash) await updateSplash('Odotetaan verkkoyhteyttä...');

    let basicConnectivityEstablished = false;
    let recoveryInProgress = false;

    while (Date.now() - startTime < timeoutMs) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`🔄 Network check #${failCount + 1} (${elapsed}s elapsed)...`);

      if (!basicConnectivityEstablished) {
        if (await this.checkBasicConnectivity()) {
          console.log('🎯 Basic connectivity (IP + DNS) established - now checking BBS...');
          basicConnectivityEstablished = true;
          if (updateSplash) await updateSplash('Perusverkko saatavilla - tarkistetaan pilvipalvelu...');
          failCount = 0;
          currentInterval = 1000;
        }
      }

      if (basicConnectivityEstablished && await this.checkInternet()) {
        const totalTime = Math.round((Date.now() - startTime) / 1000);
        console.log(`✅ Full network connectivity established after ${totalTime}s`);
        return true;
      }

      failCount++;

      // Stage 1: Gather diagnostics
      if ((failCount === 3 && !basicConnectivityEstablished) || (failCount === 2 && basicConnectivityEstablished)) {
        this.logNetworkDiagnostics();
      }

      // Stage  stage 2: Attempt recoveries
      if (!basicConnectivityEstablished && !recoveryInProgress) {
        // Recovery 1: Reapply (gentle)
        if (failCount === 6) {
          recoveryInProgress = true;
          console.log('🔄 Recovery Stage 1: Attempting WiFi reapply...');
          exec('sudo nmcli device reapply wlan0 2>/dev/null', (err) => {
            recoveryInProgress = false;
            if (!err) console.log('✅ WiFi reapply successful');
          });
        }
        // Recovery 2: Connection Up
        else if (failCount === 12) {
          recoveryInProgress = true;
          console.log('🔄 Recovery Stage 2: Attempting manual connection up...');
          exec('sudo nmcli connection up "$(nmcli -t -f NAME,TYPE connection show --active | grep wifi | head -1 | cut -d: -f1)" 2>/dev/null', (err) => {
            recoveryInProgress = false;
            if (!err) console.log('✅ WiFi connection up attempted');
          });
        }
        // Recovery 3: NM Reload (last resort)
        else if (failCount === 18) {
          recoveryInProgress = true;
          console.log('🔄 Recovery Stage 3: Reloading NetworkManager...');
          exec('sudo nmcli general reload 2>/dev/null', (err) => {
            recoveryInProgress = false;
            if (!err) console.log('✅ NetworkManager reload attempted');
          });
        }
      }

      const remaining = Math.round((timeoutMs - (Date.now() - startTime)) / 1000);
      console.log(`⏳ Network check failed, retrying in ${currentInterval/1000}s (${remaining}s remaining)...`);
      await new Promise(r => setTimeout(r, currentInterval));
      
      if (failCount > 4 && !basicConnectivityEstablished) {
        currentInterval = Math.min(currentInterval * 1.2, 6000);
      }
    }

    return false;
  }

  logNetworkDiagnostics() {
    console.log('🔍 Gathering detailed network diagnostics...');
    exec('nmcli -t -f DEVICE,STATE,CONNECTION device status', (err, stdout) => {
      if (!err && stdout) console.log(`📊 NetworkManager devices: ${stdout.trim().replace(/\n/g, ' | ')}`);
    });
    exec('iwconfig wlan0 2>/dev/null || iwconfig 2>/dev/null | head -5', (err, stdout) => {
      if (!err && stdout) console.log(`📶 WiFi status: ${stdout.trim().replace(/\n/g, ' | ')}`);
    });
    exec('nmcli -t -f SSID,SIGNAL dev wifi | head -3', (err, stdout) => {
      if (!err && stdout) console.log(`📊 WiFi signal scan: ${stdout.trim().replace(/\n/g, ' | ')}`);
    });
  }

  async announceToCloud(updateSplash) {
    if (!this.credentials?.email || !this.config.azure?.bbsUrl) {
      console.log('ℹ️ Skipping cloud announcement: Missing credentials or BBS URL');
      return true;
    }

    if (updateSplash) await updateSplash('Ilmoitetaan laite pilvipalveluun...');
    try {
      const res = await NetworkUtils.httpRequest(`${this.config.azure.bbsUrl}/devices/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.deviceId,
          email: this.credentials.email,
          friendlyName: this.config.friendlyName || `ESPA-Pi-${this.deviceId.slice(-4)}`
        })
      }, {
        maxRetries: 5,
        timeoutMs: 10000,
        retryDelayMs: attempt => Math.min(2000 * Math.pow(2, attempt - 1), 30000)
      });

      if (res.ok) {
        console.log('✅ Device announcement successful');
        return true;
      }
    } catch (err) {
      console.error(`❌ Failed to announce device to cloud:`, err.message);
    }
    return false;
  }

  async fetchBbsStreamUrlOnce(key) {
    try {
      if (!this.config.azure?.bbsUrl) return null;
      const endpoint = `${this.config.azure.bbsUrl}/entries/${encodeURIComponent(key)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const entries = await response.json();
        return entries?.[0]?.value1 || null;
      }
    } catch (error) {
      console.error('❌ Failed to fetch from BBS:', error.message);
    }
    return null;
  }
}

module.exports = ConnectivityManager;
