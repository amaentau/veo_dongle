#!/usr/bin/env node

const puppeteer = require('puppeteer');
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const ProvisioningManager = require('./provisioning');
const CloudService = require('./cloud-service');
const NetworkUtils = require('./network-utils');
const HDMIMonitor = require('./hdmi-monitor');
const ProvisioningStateManager = require('./provisioning-state');
const IoTDeviceService = require('./iot-device-service');
require('dotenv').config();

class EspaTvPlayer {
  constructor() {
    this.browser = null;
    this.page = null;
    this.app = express();
    this.server = http.createServer(this.app);

    


    // Runtime environment helpers
    this.runtimeEnvironment = process.env.RUNTIME_ENV || (this.detectWSL() ? 'wsl' : 'raspberry');

    // Initialize HDMI monitor and state manager
    this.hdmiMonitor = new HDMIMonitor();
    this.stateManager = new ProvisioningStateManager();

    // Load configuration
    this.config = this.tryLoadConfig();

    // Load credentials
    this.credentials = this.loadCredentials();

    // Determine provisioning requirements with HDMI awareness
    // Note: This will be awaited in the async initialize() method
    this.provisioningDecision = null; // Will be set in initialize()

    this.displayConfig = this.config.display || {};
    // Display summary will be logged in initialize() after provisioning decision

    // Device configuration (allow configuration file to drive the default ID)
    this.deviceId = this.getPersistentDeviceId();

    console.log(`🔐 Credentials loaded: ${this.credentials ? 'YES' : 'NO'}`);
    if (this.credentials) {
      console.log(`   Email: ${this.credentials.email ? '***' + this.credentials.email.slice(-10) : 'MISSING'}`);
      console.log(`   Password: ${this.credentials.password ? 'YES' : 'MISSING'}`);
    }

    // Debug: overlay click indicator (enabled by default; set SHOW_CLICK_OVERLAY=false to disable)
    this.enableClickOverlay = process.env.SHOW_CLICK_OVERLAY ? (process.env.SHOW_CLICK_OVERLAY === 'true') : true;

    // Override with command line arguments if provided
    // Stream URL is always resolved from BBS; initialized as null until fetched
    this.streamUrl = null;
    this.port = this.config.port || process.env.PORT || 3000;
    this.debug = process.env.DEBUG === 'true';

    // Initialize cloud service
    this.cloudService = new CloudService(this.config, this.deviceId);
    this.cloudCoordinates = null;

    // Initialize IoT Hub device service
    this.iotService = null; // Will be initialized when connection string is available
  }

  /**
   * Determine if provisioning is required based on multiple factors
   * @returns {object} Provisioning decision with detailed reasoning
   */
  async _determineProvisioningRequirements() {
    console.log('🔍 Determining provisioning requirements...');

    // Check recovery state first
    const recoveryState = this.stateManager.checkRecoveryState();
    if (recoveryState.needsRecovery) {
      console.log(`🔄 Recovery state detected: ${recoveryState.reason}`);
      this.stateManager.recordProvisioningTrigger('recovery_required', recoveryState);
      return {
        needsProvisioning: true,
        reason: recoveryState.reason,
        confidence: 0.9,
        recovery: recoveryState
      };
    }

    // Force provisioning via environment variable
    if (process.env.FORCE_PROVISIONING === 'true') {
      console.log('⚠️ FORCE_PROVISIONING detected - Entering Provisioning Mode');
      this.stateManager.recordProvisioningTrigger('force_provisioning_env');
      return {
        needsProvisioning: true,
        reason: 'force_provisioning_env',
        confidence: 1.0
      };
    }

    // Check for valid configuration and credentials
    const hasConfig = !!(this.config?.azure?.bbsUrl);
    const hasCredentials = !!this.credentials;

    console.log(`📋 Configuration check: config=${hasConfig}, credentials=${hasCredentials}`);

    // If both are missing, always provision
    if (!hasConfig && !hasCredentials) {
      console.log('⚠️ Missing both configuration and credentials - Provisioning Mode required');
      this.stateManager.recordProvisioningTrigger('missing_config_and_credentials');
      return {
        needsProvisioning: true,
        reason: 'missing_config_and_credentials',
        confidence: 1.0
      };
    }

    // If config is missing, always provision
    if (!hasConfig) {
      console.log('⚠️ Missing configuration - Provisioning Mode required');
      this.stateManager.recordProvisioningTrigger('missing_config');
      return {
        needsProvisioning: true,
        reason: 'missing_config',
        confidence: 1.0
      };
    }

    // If credentials are missing, always provision
    if (!hasCredentials) {
      console.log('⚠️ Missing credentials - Provisioning Mode required');
      this.stateManager.recordProvisioningTrigger('missing_credentials');
      return {
        needsProvisioning: true,
        reason: 'missing_credentials',
        confidence: 1.0
      };
    }

    // Both config and credentials exist - check HDMI status
    console.log('✅ Configuration and credentials found - checking HDMI status...');

    // Check if headless override is enabled
    if (this.hdmiMonitor.isHeadlessOverrideEnabled()) {
      console.log('📱 Headless override enabled - proceeding with normal operation');
      return {
        needsProvisioning: false,
        reason: 'headless_override_enabled',
        confidence: 1.0
      };
    }

    // Check HDMI connectivity FIRST - no display means ALWAYS provision
    const hdmiStatus = await this.hdmiMonitor.checkHDMI();
    console.log(`🖥️ HDMI status: ${hdmiStatus.connected ? 'connected' : 'disconnected'} (${hdmiStatus.method}, ${(hdmiStatus.confidence * 100).toFixed(1)}% confidence)`);

    // HDMI DISCONNECTION TAKES ABSOLUTE PRECEDENCE
    // If no display is connected, ALWAYS enter provisioning mode
    if (!hdmiStatus.connected && hdmiStatus.confidence > 0.5) {
      console.log('⚠️ No HDMI display detected - entering provisioning mode for reconfiguration');
      this.stateManager.recordProvisioningTrigger('hdmi_disconnected_absolute', {
        hdmiStatus,
        reason: 'no_display_requires_provisioning'
      });
      return {
        needsProvisioning: true,
        reason: 'hdmi_disconnected_absolute',
        confidence: 0.95,
        hdmiStatus,
        waitForRetry: false
      };
    }

    // HDMI connected or uncertain - proceed with normal operation
    console.log('✅ HDMI display detected or uncertain - proceeding with normal operation');
    return {
      needsProvisioning: false,
      reason: 'hdmi_connected_normal_operation',
      confidence: 0.9,
      hdmiStatus,
      waitForRetry: false
    };
  }

  tryLoadConfig() {
    const configDir = path.join(__dirname, '..');
    const jsonConfigPath = path.join(configDir, 'config.json');

    if (!fs.existsSync(jsonConfigPath)) {
      console.log('Config file not found.');
      return null;
    }

    try {
      console.log('Loading JSON configuration from config.json');
      return JSON.parse(fs.readFileSync(jsonConfigPath, 'utf8'));
    } catch (error) {
      console.error(`Failed to parse config.json: ${error.message}`);
      return null;
    }
  }


  loadCredentials() {
    const credentialsPath = path.join(__dirname, '..', 'credentials.json');

    try {
      if (fs.existsSync(credentialsPath)) {
        console.log('Loading credentials from credentials.json');
        const raw = fs.readFileSync(credentialsPath, 'utf8');
        // Strip UTF-8 BOM and trim to avoid JSON parse errors from editors adding BOM/newlines
        const sanitized = raw.replace(/^\uFEFF/, '').trim();
        return JSON.parse(sanitized);
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



  getPersistentDeviceId() {
    const idPath = path.join(__dirname, '..', '.device-id');
    
    // 1. Try to read existing burned-in ID
    if (fs.existsSync(idPath)) {
      try {
        const content = fs.readFileSync(idPath, 'utf8');
        const match = content.match(/ID:\s*([a-zA-Z0-9-]+)/);
        if (match && match[1]) return match[1];
      } catch (e) {
        console.warn('Could not read .device-id file, attempting to regenerate');
      }
    }

    // 2. Generate new ID (Hardware Serial > Machine ID > Random)
    let id = null;
    try {
      if (fs.existsSync('/proc/cpuinfo')) {
        const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
        const match = cpuinfo.match(/Serial\s*:\s*([0-9a-fA-F]+)/);
        if (match && match[1] && match[1].replace(/0/g, '').length > 0) {
          id = `rpi-${match[1]}`;
        }
      }
      if (!id && fs.existsSync('/etc/machine-id')) {
        id = `rpi-${fs.readFileSync('/etc/machine-id', 'utf8').trim().substring(0, 16)}`;
      }
    } catch (e) {
      console.warn('Hardware detection failed:', e.message);
    }

    if (!id) id = `rpi-gen-${Math.random().toString(36).substring(2, 10)}`;

    // 3. BURN-IN: Save to protected file
    this.saveDeviceIdToIsolatedFile(id, idPath);
    return id;
  }

  saveDeviceIdToIsolatedFile(id, idPath) {
    try {
      const warning = 
`# ESPA TV DEVICE IDENTITY - DO NOT EDIT OR DELETE
# This file links this physical hardware to your cloud account.
# Deleting this will cause the device to be seen as a new unit.
ID: ${id}
`;
      // Write file (ensure it's writable first if it exists for some reason)
      if (fs.existsSync(idPath)) fs.chmodSync(idPath, 0o666);
      fs.writeFileSync(idPath, warning, 'utf8');
      
      // Set to READ-ONLY (444)
      fs.chmodSync(idPath, 0o444);
      console.log(`🔥 Identity burned-in to isolated file: ${id}`);
    } catch (e) {
      console.error('Failed to burn-in isolated identity:', e.message);
    }
  }

  /**
   * Check basic internet connectivity (IP + DNS only, fast)
   */
  async checkBasicConnectivity() {
    try {
      console.log('🔍 Checking basic network connectivity...');

      // 1. Check IP address assignment
      const os = require('os');
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

      // 2. Try DNS resolution (required for BBS connectivity)
      console.log('🔍 Testing DNS resolution...');
      const dns = require('dns').promises;
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
      console.log('🔍 Checking network connectivity...');

      // 1. Check IP address assignment
      const os = require('os');
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

      // 2. Try DNS resolution (required for BBS connectivity)
      console.log('🔍 Testing DNS resolution...');
      const dns = require('dns').promises;
      try {
        await Promise.any([
          dns.lookup('google.com'),
          dns.lookup('cloudflare.com')
        ]);
        console.log('✅ DNS resolution working');
      } catch (e) {
        console.log(`❌ DNS resolution failed: ${e.message}`);
        return false;
      }

      // Verify BBS connectivity (REQUIRED for app functionality)
      if (!this.config.azure?.bbsUrl) {
        console.log('❌ No BBS URL configured - application cannot function without cloud service');
        return false;
      }

      console.log(`🔍 Testing BBS connectivity: ${this.config.azure.bbsUrl}`);

      // First check if BBS domain can be resolved (separate from general DNS check)
      try {
        const url = new URL(this.config.azure.bbsUrl);
        console.log(`🔍 Resolving BBS domain: ${url.hostname}`);
        const dns = require('dns').promises;
        await dns.lookup(url.hostname);
        console.log(`✅ BBS domain resolved: ${url.hostname}`);
      } catch (e) {
        console.log(`❌ BBS domain resolution failed: ${e.message}`);
        return false;
      }

      // Test BBS URL with generous retries for Azure free tier cold starts
      try {
        const response = await NetworkUtils.httpRequest(this.config.azure.bbsUrl, {
          method: 'HEAD',
          headers: {
            'Cache-Control': 'no-cache',
            'User-Agent': 'Espa-TV/1.0'
          }
        }, {
          maxRetries: 8,
          timeoutMs: 30000, // 30s per attempt for slow Azure cold starts
          retryDelayMs: attempt => attempt <= 3 ? 5000 : 2000 // 5s for first 3, 2s for rest
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

      console.log('❌ BBS connectivity check failed after all retries');
      return false;
    } catch (e) {
      console.log(`❌ Network check error: ${e.message}`);
      return false;
    }
  }

  /**
   * Wait for internet connectivity with detailed diagnostics
   */
  async waitForInternet(timeoutMs = 300000, startIntervalMs = 3000) { // Increased timeout to 5 minutes for slow BBS cold starts
    const startTime = Date.now();
    let currentInterval = startIntervalMs;
    let failCount = 0;

    console.log(`🌐 Starting network connectivity check (BBS required, timeout: ${timeoutMs/1000}s)`);
    console.log(`📊 BBS URL: ${this.config.azure?.bbsUrl || 'NOT CONFIGURED'}`);
    console.log(`⏱️ Phase 1: Fast IP/DNS check, Phase 2: BBS connectivity (8 attempts × 30s)`);
    await this.updateSplash('Odotetaan verkkoyhteyttä...');

    let basicConnectivityEstablished = false;
    let recoveryInProgress = false; // Prevent multiple simultaneous recovery operations

    while (Date.now() - startTime < timeoutMs) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`🔄 Network check #${failCount + 1} (${elapsed}s elapsed)...`);

      // Phase 1: Fast basic connectivity check (if not yet established)
      if (!basicConnectivityEstablished) {
        if (await this.checkBasicConnectivity()) {
          console.log('🎯 Basic connectivity (IP + DNS) established - now checking BBS...');
          basicConnectivityEstablished = true;
          await this.updateSplash('Perusverkko saatavilla - tarkistetaan pilvipalvelu...');
          // Reset fail count and use faster intervals for BBS checks
          failCount = 0;
          currentInterval = 1000; // 1s intervals for BBS checks
        }
      }

      // Phase 2: Full connectivity check (basic + BBS)
      if (basicConnectivityEstablished && await this.checkInternet()) {
        const totalTime = Math.round((Date.now() - startTime) / 1000);
        console.log(`✅ Full network connectivity established after ${totalTime}s`);
        return true;
      }

      // If basic connectivity not established yet, use original logic
      if (!basicConnectivityEstablished) {
        // Continue with original check for basic connectivity
        if (await this.checkInternet()) {
          const totalTime = Math.round((Date.now() - startTime) / 1000);
          console.log(`✅ Network connectivity established after ${totalTime}s`);
          return true;
        }
      }

      failCount++;

      // Enhanced diagnostics at different intervals (adjusted for two-phase approach)
      if ((failCount === 3 && !basicConnectivityEstablished) || (failCount === 2 && basicConnectivityEstablished)) {
        console.log('🔍 Gathering detailed network diagnostics...');
        try {
          // Check NetworkManager status
          exec('nmcli -t -f DEVICE,STATE,CONNECTION device status', (err, stdout) => {
            if (!err && stdout) {
              console.log(`📊 NetworkManager devices: ${stdout.trim().replace(/\n/g, ' | ')}`);
            } else {
              console.log('⚠️ NetworkManager status check failed');
            }
          });

          // Check WiFi signal and connection details
          exec('iwconfig wlan0 2>/dev/null || iwconfig 2>/dev/null | head -5', (err, stdout) => {
            if (!err && stdout) {
              console.log(`📶 WiFi status: ${stdout.trim().replace(/\n/g, ' | ')}`);
            }
          });

          // Check current WiFi signal strength
          exec('nmcli -t -f SSID,SIGNAL dev wifi | head -3', (err, stdout) => {
            if (!err && stdout) {
              console.log(`📊 WiFi networks: ${stdout.trim().replace(/\n/g, ' | ')}`);
            }
          });
        } catch (e) {
          console.log('⚠️ Diagnostics gathering failed');
        }
      }

      // Network recovery attempts - BALANCED approach
      if (!basicConnectivityEstablished && !recoveryInProgress) {
        // Phase 1: Basic connectivity recovery - reasonable timing for genuine issues
        if (failCount === 6) {  // After ~30 seconds of continuous failures
          recoveryInProgress = true;
          console.log('🔄 Attempting WiFi recovery for basic connectivity...');
          try {
            // First try gentle reapply (safe)
            exec('sudo nmcli device reapply wlan0 2>/dev/null', (err, stdout) => {
              if (!err) {
                console.log('✅ WiFi reapply successful');
                recoveryInProgress = false;
                return;
              }

              // If reapply fails, try connection up (also safe)
              console.log('🔄 Reapply failed, trying connection up...');
              exec('sudo nmcli connection up "$(nmcli -t -f NAME,TYPE connection show --active | grep wifi | head -1 | cut -d: -f1)" 2>/dev/null', (err2) => {
                recoveryInProgress = false;
                if (err2) {
                  console.log(`⚠️ WiFi connection up failed: ${err2.message}`);
                } else {
                  console.log('✅ WiFi connection up attempted');
                }
              });
            });
          } catch (e) {
            recoveryInProgress = false;
            console.log('⚠️ WiFi recovery error');
          }
        }

        // NetworkManager reload as secondary recovery
        if (failCount === 12) {  // After ~60 seconds of continuous failures
          recoveryInProgress = true;
          console.log('🔄 Attempting NetworkManager reload to refresh connections...');
          try {
            // Use reload instead of restart to preserve connection state
            exec('sudo nmcli general reload 2>/dev/null || echo "NM reload not supported"', (err) => {
              recoveryInProgress = false;
              if (err) {
                console.log(`⚠️ NetworkManager reload failed: ${err.message}`);
              } else {
                console.log('✅ NetworkManager reload attempted');
              }
            });
          } catch (e) {
            recoveryInProgress = false;
            console.log('⚠️ NetworkManager reload error');
          }
        }

        // Balanced backoff for basic connectivity phase
        if (failCount > 4) {
          currentInterval = Math.min(currentInterval * 1.2, 6000); // Max 6s, moderate growth
        }
      } else {
        // Phase 2: BBS connectivity - less aggressive recovery, focus on waiting
        // Skip recovery attempts during BBS phase since connectivity is established
        // Keep 1s intervals for BBS checks
      }

      const remaining = Math.round((timeoutMs - (Date.now() - startTime)) / 1000);
      console.log(`⏳ Network check failed, retrying in ${currentInterval/1000}s (${remaining}s remaining)...`);
      await this.sleep(currentInterval);
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`❌ Network connectivity check timed out after ${totalTime}s`);
    console.log('💡 Possible issues:');
    console.log('   - WiFi signal weak or unstable');
    console.log('   - BBS service temporarily unavailable');
    console.log('   - DNS resolution problems');
    console.log('   - NetworkManager configuration issues');

    return false;
  }

  async announceToCloud(skipWait = false) {
    if (!this.credentials || !this.credentials.email || !this.config.azure || !this.config.azure.bbsUrl) {
      console.log('ℹ️ Skipping cloud announcement: Missing credentials or BBS URL');
      return true;
    }

    // Wait for internet before announcing, as we might have just booted after WiFi config
    if (!skipWait) {
      const hasInternet = await this.waitForInternet(); // Use default 5-minute timeout for BBS connectivity
      if (!hasInternet) {
        console.warn('⚠️ Cannot announce device: No internet connectivity detected');
        return false;
      }
    }

    await this.updateSplash('Ilmoitetaan laite pilvipalveluun...');
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
        retryDelayMs: attempt => Math.min(2000 * Math.pow(2, attempt - 1), 30000), // Exponential backoff
        shouldRetry: (response) => {
          // Don't retry 4xx errors (except 429)
          if (response && response.status >= 400 && response.status < 500 && response.status !== 429) {
            return false;
          }
          return true;
        }
      });

      if (res.ok) {
        console.log('✅ Device announcement successful');
        return true;
      } else {
        const errorText = await res.text().catch(() => 'No error text');
        console.warn(`⚠️ Device announcement failed (Status: ${res.status}): ${errorText}`);
      }
    } catch (err) {
      console.error(`❌ Failed to announce device to cloud:`, err.message);
    }
    
    console.error('❌ All announcement attempts failed');
    return false;
  }

  async initialize() {
    console.log('Initializing Espa-TV Player...');

    // Check for provisioning recovery state first
    const recoveryState = this.stateManager.checkRecoveryState();
    if (recoveryState.needsRecovery) {
      console.log(`🔄 Detected provisioning recovery state: ${recoveryState.reason}`);
      // Force provisioning to allow user to complete interrupted session
      process.env.FORCE_PROVISIONING = 'true';
    }

    // Determine provisioning requirements with HDMI awareness
    this.provisioningDecision = await this._determineProvisioningRequirements();

    // Log display summary if not provisioning
    if (!this.provisioningDecision.needsProvisioning) {
      this.logDisplaySummary();
    }

    try {
      // 0. Network sanity: only clean up hotspot/captive-portal if it's actually active.
      // Avoid running disruptive NetworkManager operations on every boot.
      if (!this.provisioningDecision.needsProvisioning) {
        try {
          const pm = new ProvisioningManager(this.app, this.port, this.stateManager);
          // Always remove any leftover captive-portal redirect rule (safe + idempotent),
          // even if the hotspot isn't active (covers interrupted provisioning runs).
          await pm.cleanupCaptivePortalRules();
          if (await pm.isHotspotActive()) {
            console.log('🧹 Hotspot still active; cleaning up...');
            await pm.cleanupHotspot();
          }
        } catch (e) {
          // Ignore failures here
        }
      }

      // 1. Setup and start server first (required for splash page and API)
      this.setupServer();
      await new Promise((resolve, reject) => {
        this.server.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${this.port} is already in use.`);
            reject(err);
          } else {
            reject(err);
          }
        });
        this.server.listen(this.port, () => {
          console.log(`🔌 Server listening on port ${this.port}`);
          resolve();
        });
      });

      // 2. Launch browser ASAP to show splash screen
      if (!this.provisioningDecision.needsProvisioning) {
        try {
          await this.launchBrowser();
          const splashUrl = `http://127.0.0.1:${this.port}/splash.html`;
          console.log(`🌐 Showing splash screen: ${splashUrl}`);
          await this.page.goto(splashUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.updateSplash('Käynnistetään...');
        } catch (e) {
          console.error('⚠️ Failed to show splash screen:', e.message);
        }
      }

      // Provisioning check with HDMI awareness
      if (this.provisioningDecision.needsProvisioning) {
        console.log(`🚀 Entering Provisioning Mode: ${this.provisioningDecision.reason}`);
        this.stateManager.recordProvisioningStart(
          this.stateManager.generateSessionId(),
          { reason: this.provisioningDecision.reason, hdmiStatus: this.provisioningDecision.hdmiStatus }
        );

        // Start HDMI monitoring first to detect when display becomes available
        this.startHDMIMonitoring();

        // Check if HDMI is currently connected
        const currentHdmiStatus = await this.hdmiMonitor.checkHDMI();

        if (currentHdmiStatus.connected && currentHdmiStatus.confidence > 0.5) {
          // HDMI is connected, launch browser immediately
          console.log('🖥️ HDMI is connected at provisioning start - launching browser');
          await this.launchBrowserForProvisioning();
        } else {
          // HDMI not connected, wait for it or launch anyway for headless development
          console.log('📺 HDMI not connected at provisioning start - waiting for connection or launching anyway');
          // Still launch browser in case we're in a development environment
          try {
            await this.launchBrowserForProvisioning();
          } catch (e) {
            console.log('ℹ️ Browser launch failed (expected if no display) - will retry when HDMI connects');
          }
        }

        const provisioning = new ProvisioningManager(this.app, this.port, this.stateManager);
        await provisioning.start();
        // Server listen is handled in start()
        return;
      }

      // Handle HDMI wait-for-retry case
      if (this.provisioningDecision.waitForRetry) {
        console.log('⏳ HDMI disconnected - waiting for potential reconnection...');
        await this.updateSplash('Odotetaan näyttöyhteyttä...');

        const hdmiWaitResult = await this.hdmiMonitor.waitForHDMI(10000, 1000); // 10 second wait
        if (!hdmiWaitResult.connected) {
          console.log('❌ HDMI still disconnected after wait - entering provisioning mode');
          this.stateManager.recordProvisioningTrigger('hdmi_wait_timeout', hdmiWaitResult);

          this.stateManager.recordProvisioningStart(
            this.stateManager.generateSessionId(),
            { reason: 'hdmi_wait_timeout', hdmiWaitResult }
          );

          const provisioning = new ProvisioningManager(this.app, this.port, this.stateManager);
          await provisioning.start();
          return;
        } else {
          console.log('✅ HDMI reconnected - proceeding with normal operation');
        }
      }

      await this.updateSplash('Tarkistetaan verkkoyhteyttä...');
      
      // 3. Wait for Internet and Announce device to cloud
      // We MUST ensure internet is available and announcement is done before we try to fetch our config/URL
      const internetReady = await this.waitForInternet(); // Use default 5-minute timeout for BBS connectivity
      if (!internetReady) {
        throw new Error('Verkkoyhteyttä ei saatu muodostettua. Pilvisynkronointi ei ole mahdollista.');
      }

      try {
        await this.announceToCloud(true); // Skip internal wait since we just did it
      } catch (err) {
        console.error('Failure in device announcement:', err.message);
      }

      // 4. Fetch stream URL and coordinates
      // First check for local Stream URL configuration
      if (process.env.STREAM_URL) {
        this.streamUrl = process.env.STREAM_URL;
        console.log(`🎯 Using configured Stream URL: ${this.streamUrl}`);
      } else {
        await this.updateSplash('Synkronoidaan pilvipalvelun kanssa...');
        // Initialize cloud service and fetch stream URL + coordinates
        await this.cloudService.initialize();
        
        const bbsKey = process.env.BBS_KEY || this.deviceId;
        console.log(`🔍 Fetching stream URL and coordinates from BBS (key: ${bbsKey})...`);
        
        await this.updateSplash('Haetaan lähetyksen tietoja...');
        const [bbsUrl, coords] = await Promise.all([
          this.fetchBbsStreamUrlOnce(bbsKey),
          this.cloudService.getCoordinates()
        ]);
        
        if (bbsUrl) {
          this.streamUrl = bbsUrl;
          console.log(`🎯 Using stream URL from BBS: ${this.streamUrl}`);
        } else {
           console.log(`⚠️ No stream URL found on BBS for key "${bbsKey}"`);
        }

        if (coords) {
          this.cloudCoordinates = coords;
          console.log('📍 Using coordinates from cloud');
        } else {
          console.log('⚠️ No coordinates found in cloud, falling back to local config');
          this.cloudCoordinates = this.config.coordinates;
        }

        // Initialize IoT Hub connection if available
        await this.initializeIoTHubConnection();
      }

      if (!this.streamUrl) {
         throw new Error('No Stream URL configured (env: STREAM_URL) or found in BBS');
      }

      // Setup auth handlers
      console.log('🛡️ Setting up auth handlers...');
      try {
        await this.setupAuthHandlers();
        console.log('✅ Auth handlers configured');
      } catch (error) {
        console.log('⚠️ Auth handler setup failed:', error.message);
      }

      // Try stream first - it might already be authenticated
      await this.updateSplash('Avataan lähetystä...');
      console.log('🎬 Loading stream...');

      try {
        await this.goToStream();
        console.log('✅ Stream loaded successfully');
      } catch (error) {
        console.log('⚠️ Stream loading failed:', error.message);
        console.log('🔄 This might need authentication, will check for login...');
      }

      // Only try login if we were redirected to a login page
      const currentUrl = this.page.url();

      if (currentUrl.includes('login') || currentUrl.includes('signin')) {
        await this.updateSplash('Kirjaudutaan palveluun...');
        console.log('🔐 Redirected to login, authenticating...');
        try {
          await this.loginToVeo();
          await this.updateSplash('Palataan lähetykseen...');
          console.log('🎬 Going back to stream after login...');
          await this.goToStream();
        } catch (error) {
          console.log('⚠️ Login failed:', error.message);
        }
      }

      // Start HDMI monitoring for potential re-provisioning triggers
      this.startHDMIMonitoring();

      console.log(`✅ Espa-TV Player ready. Access at http://localhost:${this.port}`);
    } catch (error) {
      console.error('❌ Initialization failed:', error.message);
      console.log('Starting recovery mode...');
      this.setupRecoveryMode();
    }
  }

  async updateSplash(message) {
    if (this.page) {
      try {
        await this.page.evaluate((msg) => {
          if (window.updateStatus) window.updateStatus(msg);
        }, message);
      } catch (e) {
        // Ignore errors if page is navigating
      }
    }
  }

  /**
   * Start HDMI monitoring for provisioning guide updates or disconnection detection
   */
  startHDMIMonitoring() {
    if (this.hdmiMonitorInterval) {
      clearInterval(this.hdmiMonitorInterval);
    }

    // Track last known HDMI state
    this.lastHdmiConnected = null;

    console.log('👀 Starting HDMI monitoring');

    // Check HDMI status every 2 seconds
    this.hdmiMonitorInterval = setInterval(async () => {
      try {
        const hdmiStatus = await this.hdmiMonitor.checkHDMI();

        // Check if HDMI state changed
        if (this.lastHdmiConnected !== null && this.lastHdmiConnected !== hdmiStatus.connected) {
          console.log(`🖥️ HDMI state changed: ${this.lastHdmiConnected ? 'connected' : 'disconnected'} → ${hdmiStatus.connected ? 'connected' : 'disconnected'}`);

          if (!hdmiStatus.connected && hdmiStatus.confidence > 0.5) {
            // HDMI was disconnected - this might trigger re-provisioning
            console.log('⚠️ HDMI disconnected during operation - checking if re-provisioning needed');
            await this.handleHDMIDisconnection();
          } else if (hdmiStatus.connected && hdmiStatus.confidence > 0.5) {
            // HDMI was connected - ensure display is working in provisioning mode
            console.log('✅ HDMI connected during operation - ensuring display visibility');
            await this.handleHDMIconnection();
          }
        }

        this.lastHdmiConnected = hdmiStatus.connected;

        // Update provisioning guide if in provisioning mode
        if (this.provisioningDecision && this.provisioningDecision.needsProvisioning) {
          await this.updateProvisioningGuide(hdmiStatus);
        }
      } catch (error) {
        console.debug('HDMI monitoring error:', error.message);
      }
    }, 2000);
  }

  /**
   * Launch browser specifically for provisioning mode
   */
  async launchBrowserForProvisioning() {
    try {
      await this.launchBrowser();
      const guideUrl = `http://127.0.0.1:${this.port}/provisioning-guide.html`;
      console.log(`📺 Showing provisioning guide: ${guideUrl}`);
      await this.page.goto(guideUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Get current HDMI status and update the guide
      const hdmiStatus = await this.hdmiMonitor.checkHDMI();
      await this.updateProvisioningGuide(hdmiStatus);

      console.log('✅ Provisioning browser launched successfully');
    } catch (e) {
      console.error('⚠️ Failed to launch provisioning browser:', e.message);
      throw e;
    }
  }

  /**
   * Handle HDMI connection during provisioning mode
   */
  async handleHDMIconnection() {
    if (!this.provisioningDecision || !this.provisioningDecision.needsProvisioning) {
      return; // Only relevant during provisioning
    }

    console.log('🖥️ HDMI connected during provisioning - ensuring display visibility');

    try {
      // If browser is not launched yet, launch it now
      if (!this.browser || !this.page) {
        console.log('🚀 Browser not launched yet, launching now that HDMI is connected');
        await this.launchBrowserForProvisioning();
      } else {
        // Browser is already launched, ensure it's visible on the new display
        console.log('🔄 Browser already launched, refreshing to ensure visibility on new display');

        // Method 1: Force page refresh
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });

        // Method 2: Try to bring browser window to front
        const pages = await this.browser.pages();
        if (pages.length > 0) {
          await pages[0].bringToFront();
        }
      }

      // Method 3: Update display configuration if running on Linux
      if (process.platform === 'linux') {
        await this.updateDisplayConfiguration();
      }

      console.log('✅ Display visibility actions completed - provisioning guide should now be visible');
    } catch (error) {
      console.warn('⚠️ Failed to ensure display visibility:', error.message);
    }
  }

  /**
   * Update display configuration when HDMI connects
   */
  async updateDisplayConfiguration() {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      console.log('🔧 Updating display configuration for HDMI connection');

      // Try xrandr to detect and configure displays
      try {
        const { stdout } = await execAsync('xrandr --auto 2>/dev/null || true');
        console.log('✅ Display auto-configuration attempted');
      } catch (error) {
        console.debug('xrandr not available or failed');
      }

      // Force Chromium to redraw (send a window manager hint)
      if (this.page) {
        await this.page.evaluate(() => {
          // Force a repaint by triggering a style recalculation
          document.body.style.display = 'none';
          setTimeout(() => {
            document.body.style.display = '';
          }, 100);
        });
      }
    } catch (error) {
      console.debug('Display configuration update failed:', error.message);
    }
  }

  /**
   * Handle HDMI disconnection during normal operation
   */
  async handleHDMIDisconnection() {
    // Check if headless override is enabled
    if (this.hdmiMonitor.isHeadlessOverrideEnabled()) {
      console.log('📱 Headless override enabled - continuing normal operation despite HDMI disconnection');
      return;
    }

    // Check current provisioning requirements
    const currentDecision = await this._determineProvisioningRequirements();

    if (currentDecision.needsProvisioning && currentDecision.reason === 'hdmi_disconnected_absolute') {
      console.log('⚠️ HDMI disconnection requires re-provisioning - entering provisioning mode');

      // Stop current stream and browser
      if (this.browser) {
        console.log('🛑 Stopping current browser session for re-provisioning');
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }

      // Clear HDMI monitoring
      if (this.hdmiMonitorInterval) {
        clearInterval(this.hdmiMonitorInterval);
        this.hdmiMonitorInterval = null;
      }

      // Trigger re-provisioning by restarting the application
      console.log('🔄 Restarting application in provisioning mode...');
      process.env.FORCE_PROVISIONING = 'true';
      process.exit(0);
    } else {
      console.log('ℹ️ HDMI disconnected but not triggering re-provisioning (reason:', currentDecision.reason, ')');
    }
  }

  /**
   * Update provisioning guide with current HDMI status
   */
  async updateProvisioningGuide(hdmiStatus) {
    if (!this.page) return;

    try {
      await this.page.evaluate((status) => {
        // Update status display
        const statusValue = document.querySelector('.status-value.blink');
        if (statusValue) {
          if (status.connected) {
            statusValue.textContent = 'HDMI yhdistetty ✓';
            statusValue.className = 'status-value';
            statusValue.style.color = '#00ff00';
          } else {
            statusValue.textContent = 'Odotetaan yhteyttä...';
            statusValue.className = 'status-value blink';
            statusValue.style.color = '';
          }
        }

        // Add visual indicator for HDMI connection
        let hdmiIndicator = document.querySelector('.hdmi-indicator');
        if (!hdmiIndicator) {
          hdmiIndicator = document.createElement('div');
          hdmiIndicator.className = 'hdmi-indicator';
          hdmiIndicator.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 15px;
            border-radius: 8px;
            font-size: 0.9rem;
            backdrop-filter: blur(5px);
          `;
          document.body.appendChild(hdmiIndicator);
        }

        if (status.connected) {
          hdmiIndicator.innerHTML = '🖥️ HDMI: Yhdistetty';
          hdmiIndicator.style.background = 'rgba(0, 128, 0, 0.8)';
        } else {
          hdmiIndicator.innerHTML = '📺 HDMI: Ei yhdistettyä';
          hdmiIndicator.style.background = 'rgba(255, 165, 0, 0.8)';
        }
      }, hdmiStatus);
    } catch (error) {
      // Page might be navigating or not ready
      console.debug('Failed to update provisioning guide:', error.message);
    }
  }


  setupRecoveryMode() {
    console.log('Setting up recovery mode...');

    // Setup basic server without browser
    this.app.get('/recovery', (req, res) => {
      res.json({
        status: 'recovery',
        message: 'Browser failed to launch. Check logs for details.',
        timestamp: new Date().toISOString(),
        diagnostics: this.getDiagnostics()
      });
    });

    this.app.post('/recovery/restart', async (req, res) => {
      try {
        console.log('Manual restart requested...');
        await this.stop();
        await this.sleep(2000);
        await this.initialize();
        res.json({ success: true, message: 'Restart initiated' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    console.log('Recovery mode active. Access diagnostics at http://localhost:' + this.port + '/recovery');
  }

  getDiagnostics() {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      config: {
        port: this.port,
        streamUrl: this.streamUrl,
        hasCredentials: !!this.credentials,
        hasConfig: !!this.config,
        deviceId: this.deviceId
      },
      browser: {
        isRunning: !!this.browser,
        hasPage: !!this.page
      },
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  logDisplaySummary() {
    const modes = Array.isArray(this.displayConfig.modes) && this.displayConfig.modes.length > 0
      ? this.displayConfig.modes.join(', ')
      : 'default';
    const preferred = this.displayConfig.preferredMode || 'auto';
    console.log(`🖥️ Display configuration: preferred=${preferred}; modes=${modes}`);
  }

  logDebug(...args) {
    if (this.debug) {
      try {
        console.log(...args);
      } catch (_) {}
    }
  }

  

  async resolveClickCoordinates(action) {
    // Determine current render width
    let currentWidth = 0;
    try {
      currentWidth = await this.page.evaluate(() => window.innerWidth || document.documentElement.clientWidth || 0);
    } catch (_) {}
    if (!currentWidth) {
      try {
        const vp = this.page.viewport && this.page.viewport();
        currentWidth = (vp && vp.width) || 0;
      } catch (_) {}
    }
    if (!currentWidth) {
      currentWidth = (this.config.viewport && this.config.viewport.width) || 1920;
    }

    const coordsSource = this.cloudCoordinates || this.config.coordinates || {
      1280: { play: { x: 63, y: 681 }, fullscreen: { x: 1136, y: 678 }, baseWidth: 1280 },
      1920: { play: { x: 87, y: 1032 }, fullscreen: { x: 1771, y: 1032 }, baseWidth: 1920 },
      3840: { play: { x: 114, y: 2124 }, fullscreen: { x: 3643, y: 2122 }, baseWidth: 3840 }
    };
    const bases = Object.keys(coordsSource).map(n => parseInt(n, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
    
    if (bases.length === 0) {
      console.warn('⚠️ No coordinate bases found even in fallbacks, using hardcoded 1920 defaults');
      return action === 'play' ? { x: 87, y: 1032 } : { x: 1771, y: 1032 };
    }

    let chosenWidth = bases[0];
    let minDiff = Math.abs(currentWidth - bases[0]);
    for (const bw of bases) {
      const d = Math.abs(currentWidth - bw);
      if (d < minDiff) { minDiff = d; chosenWidth = bw; }
    }

    const ref = coordsSource[chosenWidth];
    const base = ref && ref[action];
    if (!base) throw new Error(`No coordinates for action '${action}'`);

    const scale = currentWidth / (ref.baseWidth || chosenWidth);
    const scaled = { x: Math.round(base.x * scale), y: Math.round(base.y * scale) };
    this.logDebug(`🎯 Using ${action} coords: baseWidth=${chosenWidth}, currentWidth=${currentWidth}, scale=${scale.toFixed(3)} → (${scaled.x}, ${scaled.y})`);
    return scaled;
  }

  async clickControl(action, label = '') {
    const coords = await this.resolveClickCoordinates(action);
    this.logDebug(`🟢 Preparing click '${action}' at (${coords.x}, ${coords.y}) in 250ms`);
    await this.page.mouse.move(coords.x, coords.y);
    await this.showClickOverlay(coords.x, coords.y, label || action);
    await this.sleep(250);
    await this.page.mouse.click(coords.x, coords.y);
    this.logDebug(`🖱️ Clicked ${action} at (${coords.x}, ${coords.y})`);
  }

  async showClickOverlay(x, y, label = '') {
    try {
      if (!this.enableClickOverlay || !this.page) return;
      await this.page.evaluate((x, y, label) => {
        try {
          const id = `__veo_click_overlay_${Date.now()}`;
          const el = document.createElement('div');
          el.id = id;
          el.style.position = 'fixed';
          el.style.left = `${Math.max(0, x - 12)}px`;
          el.style.top = `${Math.max(0, y - 12)}px`;
          el.style.width = '24px';
          el.style.height = '24px';
          el.style.border = '3px solid rgba(255,0,0,0.9)';
          el.style.borderRadius = '50%';
          el.style.background = 'rgba(255,0,0,0.15)';
          el.style.zIndex = '2147483647';
          el.style.pointerEvents = 'none';
          el.style.boxShadow = '0 0 8px rgba(255,0,0,0.6)';
          el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';

          if (label) {
            const tag = document.createElement('div');
            tag.textContent = label;
            tag.style.position = 'absolute';
            tag.style.top = '26px';
            tag.style.left = '-6px';
            tag.style.font = 'bold 10px sans-serif';
            tag.style.color = 'rgba(255,0,0,0.9)';
            tag.style.background = 'rgba(255,255,255,0.6)';
            tag.style.padding = '1px 3px';
            tag.style.borderRadius = '3px';
            tag.style.pointerEvents = 'none';
            el.appendChild(tag);
          }

          document.body.appendChild(el);
          // Trigger a small pulse effect
          requestAnimationFrame(() => {
            el.style.transform = 'scale(1.25)';
            setTimeout(() => {
              el.style.opacity = '0';
              el.style.transform = 'scale(1)';
              setTimeout(() => { el.remove(); }, 450);
            }, 350);
          });
        } catch {}
      }, x, y, label);
    } catch {}
  }

  

  

  

  setupServer() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Basic health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // HDMI and provisioning diagnostics
    this.app.get('/diagnostics', async (req, res) => {
      try {
        const hdmiDiagnostics = await this.hdmiMonitor.getDiagnostics();
        const provisioningState = this.stateManager.getState();
        const provisioningStats = this.stateManager.getStatistics();

        res.json({
          timestamp: new Date().toISOString(),
          hdmi: hdmiDiagnostics,
          provisioning: {
            currentDecision: this.provisioningDecision,
            state: provisioningState,
            statistics: provisioningStats
          },
          system: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            uptime: process.uptime(),
            memory: process.memoryUsage()
          }
        });
      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Force re-provisioning (admin endpoint)
    this.app.post('/admin/reprovision', async (req, res) => {
      try {
        console.log('🔄 Admin re-provisioning requested');

        // Record the trigger
        this.stateManager.recordProvisioningTrigger('admin_reprovision_request', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          reason: req.body?.reason || 'admin_request'
        });

        // Check if we're currently in a provisioning session
        const recoveryState = this.stateManager.checkRecoveryState();
        if (recoveryState.needsRecovery) {
          return res.status(409).json({
            error: 'Device is already in recovery/provisioning state',
            recoveryState,
            timestamp: new Date().toISOString()
          });
        }

        // Create new provisioning session
        const sessionId = this.stateManager.generateSessionId();
        this.stateManager.recordProvisioningStart(sessionId, {
          trigger: 'admin_reprovision',
          ip: req.ip,
          reason: req.body?.reason
        });

        // Stop current browser if running
        if (this.browser) {
          console.log('🛑 Stopping current browser session...');
          await this.browser.close();
          this.browser = null;
          this.page = null;
        }

        // Close current server connections gracefully
        if (this.server) {
          console.log('🔌 Closing current server...');
          this.server.close();
        }

        res.json({
          success: true,
          message: 'Re-provisioning initiated. Device will restart momentarily.',
          sessionId,
          timestamp: new Date().toISOString()
        });

        // Delay restart to allow response to be sent
        setTimeout(async () => {
          console.log('🔄 Restarting application in provisioning mode...');

          // Force provisioning on next start
          process.env.FORCE_PROVISIONING = 'true';

          // Exit process - systemd will restart us
          process.exit(0);
        }, 2000);

      } catch (error) {
        console.error('❌ Re-provisioning request failed:', error);
        res.status(500).json({
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Check HDMI status
    this.app.get('/hdmi/status', async (req, res) => {
      try {
        const status = await this.hdmiMonitor.checkHDMI();
        res.json({
          status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

  }


  async launchBrowser() {
    console.log('🚀 Launching Chromium...');
    console.log(`Environment: ${this.runtimeEnvironment}`);

    const browserConfig = this.config.browser || {};
    const resolvedExecutable = this.locateChromiumExecutable(browserConfig.executablePath);
    if (!resolvedExecutable) {
      throw new Error('Chromium executable not found. Install Chromium or set config.browser.executablePath.');
    }

    const collectArgs = [];
    const seenArgs = new Set();
    const pushArg = (arg) => {
      if (!arg || seenArgs.has(arg)) return;
      seenArgs.add(arg);
      collectArgs.push(arg);
    };

    // Essential flags for kiosk mode on Raspberry Pi and WSL
    const defaultChromiumArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--kiosk',
      '--start-fullscreen',
      '--hide-scrollbars',
      '--disable-infobars',
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
      '--ignore-certificate-errors',
      '--disable-background-timer-throttling',     // keep timers consistent
    '--disable-backgrounding-occluded-windows',  // prevent hidden tab throttling
    '--disable-renderer-backgrounding',          // avoid frame drops
    '--enable-features=VaapiVideoDecoder',       // enable GPU video decode (VAAPI)
    '--use-gl=egl',                              // use EGL for rendering
    '--ignore-gpu-blocklist',                    // force GPU acceleration
    ];

    // Add environment-specific flags
    if (this.runtimeEnvironment === 'wsl') {
      defaultChromiumArgs.push('--disable-features=VizDisplayCompositor');
      defaultChromiumArgs.push('--no-zygote');
    }

    defaultChromiumArgs.forEach(pushArg);

    if (Array.isArray(browserConfig.args)) {
      browserConfig.args.forEach(pushArg);
    }
    if (Array.isArray(browserConfig.extraArgs)) {
      browserConfig.extraArgs.forEach(pushArg);
    }

    const launchOptions = {
      headless: browserConfig.headless ?? false,
      defaultViewport: browserConfig.defaultViewport ?? null,
      executablePath: resolvedExecutable,
      args: collectArgs,
      timeout: browserConfig.timeout ?? 30000,
      ignoreDefaultArgs: browserConfig.ignoreDefaultArgs ?? ['--enable-automation'],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':0',
        XAUTHORITY: process.env.XAUTHORITY || (process.env.HOME ? path.join(process.env.HOME, '.Xauthority') : undefined),
        ...(browserConfig.env || {})
      }
    };

    if (browserConfig.userDataDir) {
      launchOptions.userDataDir = browserConfig.userDataDir;
    }

    this.logDebug('🔧 Launch options (env.DISPLAY):', launchOptions.env.DISPLAY);
    this.logDebug('🔧 Launch options (env.XAUTHORITY):', launchOptions.env.XAUTHORITY);
    
    // Retry launch up to 3 times (useful during busy boot sequence)
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.browser = await puppeteer.launch(launchOptions);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        console.warn(`⚠️ Browser launch attempt ${attempt} failed: ${e.message}`);
        console.warn(`   Environment - DISPLAY: "${process.env.DISPLAY}", XAUTHORITY: "${process.env.XAUTHORITY}", HOME: "${process.env.HOME}"`);
        await this.sleep(2000);
      }
    }

    if (lastError) throw lastError;

    // Use initial page instead of creating new one
    const pages = await this.browser.pages();
    this.logDebug(`📄 Pages after launch: ${pages.length}`);

    if (pages.length > 0) {
      this.page = pages[0];
      this.logDebug('✅ Using initial page');
    } else {
      this.page = await this.browser.newPage();
      this.logDebug('✅ Created new page');
    }

    await this.page.bringToFront();

    // Optionally configure viewport presets if explicitly requested
    await this.setupViewport();

    // Enable click coordinate logging for manual capture
    await this.enableClickCoordinateLoggerSafe();

    // Log actual content viewport for diagnostics
    try {
      const size = await this.page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      }));
      this.logDebug(`🖥️ Content viewport: ${size.width}x${size.height} @${size.dpr}x DPR`);
    } catch (_) {}

    console.log('✅ Browser launched');
  }


  detectWSL() {
    try {
      if (require('fs').existsSync('/proc/version')) {
        const version = require('fs').readFileSync('/proc/version', 'utf8');
        return version.toLowerCase().includes('microsoft');
      }
    } catch (error) {
      // Ignore errors in detection
    }
    return false;
  }

  async setupViewport() {
    try {
      const forceFlag = process.env.FORCE_VIEWPORT === 'true' || (this.config.viewport && this.config.viewport.force === true);
      const preset = process.env.VIEWPORT_PRESET || (this.config.viewport && this.config.viewport.preset) || '';

      // Map presets to sizes
      const presets = {
        '720p': { width: 1280, height: 720 },
        '1080p': { width: 1920, height: 1080 },
        '4k': { width: 3840, height: 2160 }
      };

      const explicit = this.config.viewport && typeof this.config.viewport.width === 'number' && typeof this.config.viewport.height === 'number'
        ? { width: this.config.viewport.width, height: this.config.viewport.height }
        : null;

      const chosen = presets[preset.toLowerCase()] || explicit;

      if (forceFlag && chosen) {
        await this.page.setViewport(chosen);
        this.logDebug(`🖼️ Forced viewport to ${chosen.width}x${chosen.height} (preset: ${preset || 'explicit'})`);
      } else {
        this.logDebug('🖼️ Using window-sized viewport (defaultViewport=null). Set FORCE_VIEWPORT=true to override.');
      }
    } catch (e) {
      this.logDebug('⚠️ Viewport setup skipped:', e.message);
    }
  }

  locateChromiumExecutable(explicitPath) {
    const candidates = [
      process.env.CHROMIUM_PATH,
      explicitPath,
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable'
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch (_) {
        // ignore invalid paths
      }
    }

    return null;
  }

  async enableClickCoordinateLoggerSafe() {
    try {
      await this.enableClickCoordinateLogger();
    } catch (e) {
      this.logDebug('⚠️ Click logger setup skipped:', e.message);
    }
  }

  async enableClickCoordinateLogger() {
    if (!this.page) return;
    try {
      // Expose a reporting function (idempotent)
      try {
        await this.page.exposeFunction('__veoReportClick', (payload) => {
          try {
            const { x, y, pageX, pageY, width, height, dpr, pctX, pctY, target, frameUrl } = payload || {};
            (window).__veoReportClick || console.debug(`🖱️ Click @ (${x}, ${y}) [page:${pageX},${pageY}] on ${width}x${height} (DPR=${dpr}) → ${pctX}% x, ${pctY}% y | target=<${target?.tag || '?'} aria="${target?.aria || ''}"> frame=${frameUrl || 'main'}`);
          } catch (e) {
            console.debug('🖱️ Click payload error:', e.message);
          }
        });
      } catch (_) { /* already exposed */ }

      const inject = async (frame) => {
        try {
          await frame.evaluate(() => {
            try {
              if ((window).__veoClickLoggerInstalled) return;
              (window).__veoClickLoggerInstalled = true;
              const handler = (e) => {
                try {
                  const w = window.innerWidth || document.documentElement.clientWidth || 0;
                  const h = window.innerHeight || document.documentElement.clientHeight || 0;
                  const dpr = window.devicePixelRatio || 1;
                  const data = {
                    x: Math.round(e.clientX),
                    y: Math.round(e.clientY),
                    pageX: Math.round(e.pageX || 0),
                    pageY: Math.round(e.pageY || 0),
                    width: w,
                    height: h,
                    dpr,
                    pctX: w ? +(e.clientX / w * 100).toFixed(2) : null,
                    pctY: h ? +(e.clientY / h * 100).toFixed(2) : null,
                    target: {
                      tag: (e.target && e.target.tagName) || null,
                      aria: (e.target && e.target.getAttribute && e.target.getAttribute('aria-label')) || null
                    },
                    frameUrl: (window.location && window.location.href) || null
                  };
                  (window).__veoReportClick && (window).__veoReportClick(data);
                } catch {}
              };
              window.addEventListener('click', handler, true);
            } catch {}
          });
        } catch (_) { /* ignore frame evaluate errors */ }
      };

      // Inject into main frame and child frames
      await inject(this.page.mainFrame());
      for (const f of this.page.frames()) {
        await inject(f);
      }

      // Re-inject on future frame attachments
      this.page.on('frameattached', async (f) => {
        try { await inject(f); } catch (_) {}
      });
    } catch (e) {
      console.log('⚠️ Failed to enable click coordinate logger:', e.message);
    }
  }

  async waitForPlayerSurface(maxWaitMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const found = await this.page.evaluate(() => {
          return !!(document.querySelector('.veo-player-container') || document.querySelector('veo-player') || document.querySelector('video'));
        });
        if (found) return true;
      } catch (_) {}
      await this.sleep(200);
    }
    return false;
  }

  /**
   * Enhanced wait for video player to be fully ready for interaction
   */
  async waitForPlayerReady(maxWaitMs = 10000) {
    const start = Date.now();
    this.logDebug('🎬 Waiting for player to be fully ready...');

    while (Date.now() - start < maxWaitMs) {
      try {
        const playerState = await this.page.evaluate(() => {
          // Check for player container
          const container = document.querySelector('.veo-player-container') || document.querySelector('veo-player');
          if (!container) return { ready: false, reason: 'no_container' };

          // Check for video element
          const video = container.querySelector('video') || document.querySelector('video');
          if (!video) return { ready: false, reason: 'no_video' };

          // Check if video has loaded metadata
          if (!video.duration || video.duration === 0 || isNaN(video.duration)) {
            return { ready: false, reason: 'no_metadata' };
          }

          // Check if video can play (not in error state)
          if (video.error) return { ready: false, reason: 'video_error' };

          // Check if video dimensions are reasonable (not 0x0)
          if (video.videoWidth === 0 || video.videoHeight === 0) {
            return { ready: false, reason: 'no_dimensions' };
          }

          // Check if player controls are visible/accessible
          const controls = container.querySelector('.vjs-control-bar') || container.querySelector('[class*="control"]');
          if (controls && window.getComputedStyle(controls).display === 'none') {
            return { ready: false, reason: 'controls_hidden' };
          }

          return {
            ready: true,
            duration: video.duration,
            dimensions: `${video.videoWidth}x${video.videoHeight}`,
            canPlay: video.readyState >= 3 // HAVE_FUTURE_DATA or better
          };
        });

        if (playerState.ready) {
          this.logDebug(`✅ Player ready: ${playerState.dimensions}, duration: ${playerState.duration}s`);
          return true;
        } else {
          this.logDebug(`⏳ Player not ready: ${playerState.reason}`);
        }
      } catch (e) {
        this.logDebug(`⚠️ Player state check error: ${e.message}`);
      }

      await this.sleep(500); // Check every 500ms
    }

    this.logDebug('❌ Player readiness timeout');
    return false;
  }

  /**
   * Check if video is already playing
   */
  async isVideoPlaying() {
    try {
      return await this.page.evaluate(() => {
        const video = document.querySelector('video');
        if (!video) return false;

        // Check multiple indicators of playing state
        return !!(video.currentTime > 0 && !video.paused && !video.ended && video.readyState >= 3);
      });
    } catch (_) {
      return false;
    }
  }

  /**
   * Alternative approach: Wait for video events to indicate readiness
   * This can be used instead of or in addition to waitForPlayerReady
   */
  async waitForVideoEvents(timeoutMs = 10000) {
    try {
      console.log('🎬 Setting up video event monitoring...');

      // Inject event listeners and wait for specific events
      const eventsReceived = await this.page.evaluate((timeout) => {
        return new Promise((resolve) => {
          const video = document.querySelector('video');
          if (!video) {
            resolve({ success: false, reason: 'no_video' });
            return;
          }

          const events = [];
          const eventTimeout = setTimeout(() => {
            resolve({
              success: false,
              reason: 'timeout',
              events: events
            });
          }, timeout);

          const recordEvent = (eventName) => {
            events.push(eventName);
            console.log(`🎬 Video event: ${eventName}`);
          };

          // Listen for key readiness events
          video.addEventListener('loadstart', () => recordEvent('loadstart'));
          video.addEventListener('loadedmetadata', () => recordEvent('loadedmetadata'));
          video.addEventListener('loadeddata', () => recordEvent('loadeddata'));
          video.addEventListener('canplay', () => recordEvent('canplay'));
          video.addEventListener('canplaythrough', () => recordEvent('canplaythrough'));
          video.addEventListener('play', () => recordEvent('play'));
          video.addEventListener('playing', () => recordEvent('playing'));

          // Success condition: either canplay + reasonable duration, or actual playing
          const checkSuccess = () => {
            if (events.includes('canplay') && video.duration > 0 && !isNaN(video.duration)) {
              clearTimeout(eventTimeout);
              resolve({
                success: true,
                reason: 'canplay_with_duration',
                events: events,
                duration: video.duration
              });
            } else if (events.includes('playing')) {
              clearTimeout(eventTimeout);
              resolve({
                success: true,
                reason: 'already_playing',
                events: events
              });
            }
          };

          // Check immediately in case events already fired
          checkSuccess();

          // Set up periodic checks
          const interval = setInterval(checkSuccess, 200);

          // Clean up interval on timeout
          setTimeout(() => clearInterval(interval), timeout);
        });
      }, timeoutMs);

      if (eventsReceived.success) {
        console.log(`✅ Video events indicate ready: ${eventsReceived.reason}`);
        return true;
      } else {
        console.log(`⚠️ Video events timeout: ${eventsReceived.reason}`);
        return false;
      }
    } catch (e) {
      console.log(`⚠️ Video event monitoring failed: ${e.message}`);
      return false;
    }
  }


  async fetchBbsStreamUrlOnce(key) {
    try {
      if (!this.config.azure || !this.config.azure.bbsUrl) {
        console.log('BBS URL not configured.');
        return null;
      }

      const endpoint = `${this.config.azure.bbsUrl}/entries/${encodeURIComponent(key)}`;
      console.log(`📡 Fetching BBS entries from: ${endpoint}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`BBS HTTP ${response.status}: ${response.statusText}`);
      }

      const entries = await response.json();
      if (entries && entries.length > 0 && entries[0] && entries[0].value1) {
        return entries[0].value1;
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to fetch from BBS:', error.message);
      return null;
    }
  }


  

  async setupAuthHandlers() {
    // Handle JavaScript password dialogs
    if (this.page && this.credentials) {
      this.page.on('dialog', async (dialog) => {
        try {
          if (dialog.type() === 'prompt' && this.credentials.password) {
            await dialog.accept(this.credentials.password);
            console.log('🔐 Password dialog accepted');
          } else {
            await dialog.dismiss();
          }
        } catch (e) {
          console.warn('Dialog error:', e.message);
        }
      });
    }
  }

  async isLoginPage() {
    try {
      return await this.page.evaluate(() => {
        const path = (window.location.pathname || '').toLowerCase();
        const url = (window.location.href || '').toLowerCase();
        const hasEmail = !!document.querySelector('input[type="email"], input[name*="email" i], #email');
        const hasPassword = !!document.querySelector('input[type="password"], input[name*="password" i], #password');
        const hasAuthForm = !!document.querySelector('form[action*="login" i], form[action*="signin" i]');
        const loginMarkers = /login|signin|sign-in|authenticate/.test(path) || /login|signin/.test(url);
        return (hasEmail && hasPassword) || hasAuthForm || loginMarkers;
      });
    } catch (_) {
      return false;
    }
  }

  async loginToVeo() {
    if (!this.credentials) {
      console.log('⚠️ No credentials found, skipping login');
      return;
    }

    console.log('🔐 Starting login process...');

    try {
      // If we're not already on a login page, go to configured login URL once
      const onLoginPage = await this.page.evaluate(() => {
        const hasEmail = !!document.querySelector('input[type="email"], input[name*="email" i], #email');
        const hasPassword = !!document.querySelector('input[type="password"], input[name*="password" i], #password');
        const currentPath = window.location.pathname.toLowerCase();
        return (hasEmail && hasPassword) || currentPath.includes('login') || currentPath.includes('signin');
      });

      if (!onLoginPage) {
        const loginUrl = this.config.login?.url || 'https://live.veo.co/login';
        console.log(`🌐 Navigating to login: ${loginUrl}`);
        await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      // Wait for page to fully load
      await this.sleep(2000);

      // Try to auto-accept common cookie consent banners to unblock inputs
      try {
        const accepted = await this.page.evaluate(() => {
          const matches = ['accept', 'agree', 'consent', 'allow'];
          const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
          for (const el of candidates) {
            const text = (el.innerText || el.value || '').toLowerCase();
            if (matches.some(m => text.includes(m))) {
              el.click();
              return true;
            }
          }
          const knownSelectors = [
            '#onetrust-accept-btn-handler',
            '.onetrust-accept-btn-handler',
            '#consent-accept',
            '.cookie-accept',
          ];
          for (const sel of knownSelectors) {
            const el = document.querySelector(sel);
            if (el) { el.click(); return true; }
          }
          return false;
        });
        if (accepted) {
          await this.sleep(500);
        }
      } catch (_) {
        // Ignore consent errors
      }

      // Find and fill login form fields
      this.logDebug('🔐 Filling login form fields...');

      // Try email field with expanded selectors
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name*="email" i]',
        '#email'
      ];

      let emailFound = false;
      for (const sel of emailSelectors) {
        try {
          const elements = await this.page.$$(sel);
          if (elements.length > 0) {
            await elements[0].type(this.credentials.email, { delay: 100 });
            emailFound = true;
            this.logDebug(`✅ Email field found and filled: ${sel}`);
            break;
          }
        } catch (_) {}
      }

      // Try password field with expanded selectors
      const pwdSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[name*="password" i]',
        '#password'
      ];

      let pwdFound = false;
      for (const sel of pwdSelectors) {
        try {
          const elements = await this.page.$$(sel);
          if (elements.length > 0) {
            await elements[0].type(this.credentials.password, { delay: 100 });
            pwdFound = true;
            this.logDebug(`✅ Password field found and filled: ${sel}`);
            break;
          }
        } catch (_) {}
      }

      if (!emailFound || !pwdFound) {
        this.logDebug('⚠️ Could not find both email and password fields');
        return;
      }

      // Wait a bit more for form to be fully interactive after filling fields
      await this.sleep(1000);

      // Click submit button with comprehensive search and retry logic
      this.logDebug('🔘 Looking for submit button...');

      let clicked = false;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries && !clicked; attempt++) {
        this.logDebug(`🔄 Submit button attempt ${attempt}/${maxRetries}`);

        // Try standard selectors first
        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button[name="login"]',
          'button[name="signin"]',
          '[data-testid*="login" i]'
        ];

        for (const sel of submitSelectors) {
          try {
            // Wait for element to be visible and clickable (not disabled)
            await this.page.waitForFunction(
              (selector) => {
                const el = document.querySelector(selector);
                return el && el.offsetParent !== null && !el.disabled &&
                       (el.type !== 'submit' || !el.form || el.form.checkValidity() !== false);
              },
              { timeout: attempt === 1 ? 5000 : 2000 }, // Shorter timeout on retries
              sel
            );

            const elements = await this.page.$$(sel);
            if (elements.length > 0) {
              // Additional check: ensure element is actually clickable
              const isClickable = await elements[0].evaluate(el =>
                !el.disabled && el.offsetParent !== null &&
                window.getComputedStyle(el).visibility !== 'hidden'
              );

              if (isClickable) {
                await elements[0].click();
                clicked = true;
                this.logDebug(`✅ Clicked submit button: ${sel} (attempt ${attempt})`);
                break;
              } else {
                this.logDebug(`⚠️ Submit button found but not clickable: ${sel} (attempt ${attempt})`);
              }
            }
          } catch (e) {
            this.logDebug(`⚠️ Submit button selector failed: ${sel} (attempt ${attempt}) - ${e.message}`);
          }
        }

        // If not clicked and not the last attempt, wait before retry
        if (!clicked && attempt < maxRetries) {
          const retryDelay = attempt * 1000; // 1s, 2s, 3s delays
          this.logDebug(`⏳ Submit button not found/clickable, retrying in ${retryDelay}ms...`);
          await this.sleep(retryDelay);
        }
      }

      // No aggressive text-search clicking; fall back to pressing Enter

      if (!clicked) {
        // Last resort: try to find the form and submit it
        try {
          const formSubmitted = await this.page.evaluate(() => {
            const form = document.querySelector('form');
            if (form && form.checkValidity()) {
              form.submit();
              return true;
            }
            // Try to find submit button within form and click it
            const submitBtn = form?.querySelector('button[type="submit"], input[type="submit"]');
            if (submitBtn && !submitBtn.disabled) {
              submitBtn.click();
              return true;
            }
            return false;
          });
          if (formSubmitted) {
            this.logDebug('✅ Submitted form directly');
            clicked = true;
          }
        } catch (e) {
          this.logDebug(`⚠️ Form submission failed: ${e.message}`);
        }
      }

      if (!clicked) {
        this.logDebug('⚠️ No submit button found, pressing Enter...');
        await this.page.keyboard.press('Enter');
      }

      // Wait for navigation or form submission with extended timeout for slow networks
      const postSubmitWait = new Promise(resolve => setTimeout(resolve, 8000)); // Increased to 8 seconds
      const navigationPromise = this.page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 10000 // Increased to 10 seconds
      }).catch(() => {});

      await Promise.race([navigationPromise, postSubmitWait]);
      this.logDebug(`📍 After login attempt: ${this.page.url()}`);

      // Check if we're still on a login page or if login succeeded
      const stillOnLogin = await this.page.evaluate(() => {
        const currentPath = window.location.pathname.toLowerCase();
        const hasPasswordField = !!document.querySelector('input[type="password"]');
        return currentPath.includes('login') || currentPath.includes('signin') || hasPasswordField;
      });

      if (stillOnLogin) {
        this.logDebug('⚠️ Still on login page, login may have failed');
      } else {
        this.logDebug('✅ Login appears successful - redirected away from login page');
      }

    } catch (error) {
      console.error('❌ Login error:', error.message);
      // Don't throw - continue even if login fails
    }
  }

  async goToStream() {
    console.log(`🎬 Going to stream: ${this.streamUrl}`);

    try {
      // Check if this looks like a direct video stream URL
      const isDirectStream = this.streamUrl.includes('/stream/') && (this.streamUrl.includes('@') || this.streamUrl.includes('.mp4') || this.streamUrl.includes('.m3u8'));

      if (isDirectStream) {
        console.log('🎥 Detected direct video stream URL');
        console.log('📡 Navigating to direct stream...');

        // For direct streams, use load event instead of domcontentloaded
        await this.page.goto(this.streamUrl, {
          waitUntil: 'load',
          timeout: 20000
        });

        console.log(`📍 Direct stream loaded: ${this.page.url()}`);
        console.log('✅ Direct stream navigation completed');

        // Skip player actions if this unexpectedly is a login page
        if (await this.isLoginPage()) {
          console.log('🔐 Detected login page after direct stream load; skipping playback/fullscreen');
          return;
        }

        // Ensure click coordinate logger is active after navigation
        await this.enableClickCoordinateLoggerSafe();
        // Ensure playback starts and fullscreen is enabled (coordinate-based control)
        try {
          await this.playStream();
          await this.sleep(300);
          await this.enterFullscreen();
        } catch (e) {
          console.log('⚠️ Post-navigation coordinate control failed:', e.message);
        }
        return;
      }

      console.log('📡 Starting page navigation...');
      const navigationPromise = this.page.goto(this.streamUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Add a timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Navigation timeout after 30 seconds')), 30000);
      });

      await Promise.race([navigationPromise, timeoutPromise]);
      console.log(`📍 Stream URL loaded: ${this.page.url()}`);

      // Check if we're on a login page (skip player actions)
      if (await this.isLoginPage()) {
        console.log('🔐 Detected login page; skipping playback/fullscreen until after login');
        return;
      }

      // Ensure click coordinate logger is active after navigation
      await this.enableClickCoordinateLoggerSafe();

      // Small additional wait
      await this.sleep(500);

      console.log('✅ Stream navigation completed');

      // Coordinate-based control
      try {
        await this.playStream();
        await this.sleep(400);
        await this.enterFullscreen();
      } catch (e) {
        console.log('⚠️ Post-navigation coordinate control failed:', e.message);
      }

    } catch (error) {
      console.error('❌ Error loading stream:', error.message);
      throw error;
    }
  }

  async enterFullscreen() {
    console.log('🖥️ Attempting to enter fullscreen mode...');

    try {
      if (await this.isLoginPage()) {
        console.log('🔐 On login page; not toggling fullscreen');
        return;
      }
      // Give the player surface a short moment if needed
      await this.waitForPlayerSurface(3000);
      await this.clickControl('fullscreen', 'fullscreen');

    } catch (error) {
      console.error('❌ Error entering fullscreen:', error.message);
    }
  }

  async playStream() {
    console.log('▶️ Attempting to start stream playback...');

    try {
      if (await this.isLoginPage()) {
        console.log('🔐 On login page; not attempting to play background video');
        return;
      }

      // Step 1: Wait for basic player surface
      console.log('🎬 Step 1: Waiting for player surface...');
      const hasSurface = await this.waitForPlayerSurface(5000); // Increased timeout
      if (!hasSurface) {
        throw new Error('Player surface not found within timeout');
      }

      // Step 2: Check if video is already playing (don't click if it is!)
      console.log('🎬 Step 2: Checking if video is already playing...');
      const alreadyPlaying = await this.isVideoPlaying();
      if (alreadyPlaying) {
        console.log('✅ Video is already playing - skipping play click');
        return;
      }

      // Step 3: Wait for player to be fully ready
      console.log('🎬 Step 3: Waiting for player to be fully ready...');
      const playerReady = await this.waitForPlayerReady(8000); // 8 second timeout for readiness
      if (!playerReady) {
        console.log('⚠️ Player not fully ready, but attempting play anyway...');
      }

      // Step 4: Additional delay to ensure UI is stable
      console.log('🎬 Step 4: Final stabilization delay...');
      await this.sleep(1000);

      // Step 5: Click play button
      console.log('🎬 Step 5: Clicking play button...');
      await this.clickControl('play', 'play');

      // Step 6: Verify playback started (optional verification)
      console.log('🎬 Step 6: Verifying playback...');
      await this.sleep(2000); // Wait a bit for play to take effect

      const nowPlaying = await this.isVideoPlaying();
      if (nowPlaying) {
        console.log('✅ Playback successfully started');
      } else {
        console.log('⚠️ Play click completed but video may not be playing yet');
      }

    } catch (error) {
      console.error('❌ Error starting playback:', error.message);
      throw error;
    }
  }

  /**
   * Pause stream playback
   */
  async pauseStream() {
    console.log('⏸️ Attempting to pause stream playback...');

    try {
      if (await this.isLoginPage()) {
        console.log('🔐 On login page; not attempting to pause');
        return;
      }

      // Check if video is currently playing
      const isPlaying = await this.isVideoPlaying();
      if (!isPlaying) {
        console.log('ℹ️ Video is not currently playing - nothing to pause');
        return;
      }

      // Click pause button (same coordinates as play button)
      console.log('🎬 Clicking pause button...');
      await this.clickControl('pause', 'play'); // Using same coordinates as play button

      // Verify playback paused
      await this.sleep(1000);
      const stillPlaying = await this.isVideoPlaying();
      if (!stillPlaying) {
        console.log('✅ Playback successfully paused');
      } else {
        console.log('⚠️ Pause click completed but video may still be playing');
      }

    } catch (error) {
      console.error('❌ Error pausing playback:', error.message);
      throw error;
    }
  }

  /**
   * Toggle fullscreen mode
   */
  async toggleFullscreen() {
    console.log('🔄 Toggling fullscreen mode...');

    try {
      if (await this.isLoginPage()) {
        console.log('🔐 On login page; not attempting fullscreen toggle');
        return;
      }

      // Click fullscreen button
      console.log('🎬 Clicking fullscreen button...');
      await this.clickControl('fullscreen', 'fullscreen');

      console.log('✅ Fullscreen toggle requested');

    } catch (error) {
      console.error('❌ Error toggling fullscreen:', error.message);
      throw error;
    }
  }



  async start() {
    try {
      await this.initialize();
      // Server listen is now handled inside initialize() to support splash screen
    } catch (error) {
      console.error('Failed to start Espa-TV Player:', error);
      process.exit(1);
    }
  }

  /**
   * Initialize IoT Hub connection for cloud-to-device commands
   */
  async initializeIoTHubConnection() {
    try {
      console.log('🔗 Checking for IoT Hub connection...');

      // Get IoT Hub connection string from BBS
      const iotConnection = await this.cloudService.getIoTHubConnectionString();

      if (!iotConnection) {
        console.log('ℹ️ No IoT Hub connection available - commands will work via HTTP API only');
        return;
      }

      console.log('🎯 IoT Hub connection found, initializing device client...');

      // Create IoT Device Service with appropriate credentials
      if (iotConnection.connectionString) {
        // Backward compatibility: full connection string
        this.iotService = new IoTDeviceService(this.deviceId, null, null, iotConnection.connectionString);
      } else {
        // New secure method: SAS token
        this.iotService = new IoTDeviceService(this.deviceId, iotConnection.hubName, iotConnection.sasToken);
      }

      // Set up command handler
      this.iotService.onCommand(this.handleIoTCommand.bind(this));

      // Connect to IoT Hub
      const connected = await this.iotService.connect();

      if (connected) {
        console.log('✅ IoT Hub command channel ready');
      } else {
        console.log('⚠️ IoT Hub connection failed - commands via HTTP API still available');
      }

    } catch (error) {
      console.error('❌ IoT Hub initialization failed:', error.message);
      console.log('ℹ️ Continuing without IoT Hub - HTTP API commands still available');
    }
  }

  /**
   * Handle IoT Hub commands
   */
  async handleIoTCommand(command, payload) {
    console.log(`🎮 Executing IoT command: ${command}`, payload || '');

    try {
      switch (command) {
        case 'play':
          await this.playStream();
          return { success: true, message: 'Playback started' };

        case 'pause':
          await this.pauseStream();
          return { success: true, message: 'Playback paused' };

        case 'fullscreen':
          await this.toggleFullscreen();
          return { success: true, message: 'Fullscreen toggled' };

        case 'change-track':
          // Implementation depends on Veo player API
          if (payload && payload.trackId) {
            console.log(`🎵 Changing to track: ${payload.trackId}`);
            // Add track changing logic here when available
            return { success: true, message: `Track change requested: ${payload.trackId}` };
          } else {
            return { success: false, error: 'Track ID required' };
          }

        case 'status':
          const status = {
            deviceId: this.deviceId,
            streamUrl: this.streamUrl,
            playerReady: await this.isPlayerReady(),
            provisioningMode: this.provisioningDecision && this.provisioningDecision.needsProvisioning,
            iotConnected: this.iotService && this.iotService.isConnected
          };
          return { success: true, status };

        case 'restart':
          console.log('🔄 IoT command: restart requested');
          setTimeout(() => {
            process.exit(0); // Graceful restart via process manager
          }, 1000);
          return { success: true, message: 'Restarting device' };

        default:
          console.log(`⚠️ Unknown IoT command: ${command}`);
          return { success: false, error: `Unknown command: ${command}` };
      }

    } catch (error) {
      console.error(`❌ IoT command ${command} failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async stop() {
    console.log('Stopping Espa-TV Player...');

    // Stop cloud service polling
    if (this.cloudService) {
      this.cloudService.cleanup();
    }

    // Stop IoT Hub service
    if (this.iotService) {
      await this.iotService.disconnect();
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
    }

    // Close server
    if (this.server) {
      this.server.close();
    }

    console.log('Espa-TV Player stopped');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  const player = global.playerInstance;
  if (player) {
    await player.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  const player = global.playerInstance;
  if (player) {
    await player.stop();
  }
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Do not exit process; just log it
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Do not exit process immediately; try to stay alive if possible
});

// Command-line usage
function printUsage() {
  console.log(`
Espa-TV Player - Stream Player

Usage:
  node src/index.js [options]

Stream URL:
  The stream URL is always read from the BBS service configured in config.json
  under azure.bbsUrl. The key defaults to the BBS_KEY environment variable or
  falls back to "koti" if not set.

Options:
  --help, -h    Show this help message
  --version, -v Show version information

Configuration:
  The application looks for configuration in this order:
  1. config.json (JSON format with your coordinate settings)
  2. config.js (JavaScript format)
  3. config.example.js (fallback example)

Examples:
  node src/index.js
  node src/index.js --help

API Endpoints:
  GET  /health           # Health check

Cloud API Endpoints:
  GET  /cloud/status     # Cloud service status
  POST /cloud/stream     # Update stream URL via API
  POST /cloud/store      # Store stream URL in Azure Table Storage
  GET  /cloud/latest     # Get latest stream URL from cloud (use ?key=koti)
  POST /cloud/sync       # Trigger manual cloud sync

Recovery Endpoints:
  GET  /recovery         # Recovery mode diagnostics
  POST /recovery/restart # Manual restart
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
    console.log(`Espa-TV Player v${packageInfo.version}`);
    process.exit(0);
  }

  // Start the application
  const player = new EspaTvPlayer();
  global.playerInstance = player;
  player.start().catch(error => {
    console.error('Failed to start Espa-TV Player:', error);
    process.exit(1);
  });
}

module.exports = EspaTvPlayer;
