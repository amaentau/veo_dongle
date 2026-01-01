#!/usr/bin/env node

const { TableClient } = require('@azure/data-tables');
const NetworkUtils = require('./network-utils');

/**
 * Cloud Service using Azure Table Storage
 * Implements the BBS pattern for reliable cloud interaction
 */
class CloudService {
  constructor(config, deviceId) {
    this.config = config;
    this.deviceId = deviceId;
    this.tableClient = null;
    this.pollInterval = null;
    this.isPolling = false;
    this.lastStreamUrl = null;
    this.onStreamUpdateCallback = null;
    this.bbsUrl = (config.azure && config.azure.bbsUrl) || null; // BBS HTTP endpoint
  }

  async initialize() {
    // Ensure config is at least an object
    this.config = this.config || {};
    this.config.azure = this.config.azure || {};

    // Check if BBS URL is provided (HTTP-based access)
    // We prioritize environment variable if available
    this.bbsUrl = process.env.BBS_URL || this.config.azure.bbsUrl || this.bbsUrl;

    if (this.bbsUrl) {
      console.log(`☁️ Using BBS HTTP endpoint: ${this.bbsUrl}`);
      this.useBbsHttp = true;
      
      // Start polling only if explicitly enabled
      if (this.config.azure.enabled) {
        this.startPolling();
      }
      
      console.log('✅ BBS HTTP service initialized successfully');
      return;
    }

    if (!this.config.azure.enabled) {
      console.log('☁️ Azure Table Storage not enabled, and no BBS URL found. Skipping cloud initialization.');
      return;
    }

    // Check if this is a mock connection for testing
    const isMock = this.config.azure.storageConnectionString.includes('mock');

    try {
      if (isMock) {
        console.log('🧪 Initializing MOCK Azure Table Storage for testing...');
        this.initializeMockService();
      } else {
        console.log('☁️ Initializing Azure Table Storage...');

        // Create table client
        this.tableClient = TableClient.fromConnectionString(
          this.config.azure.storageConnectionString,
          this.config.azure.tableName
        );

        // Ensure table exists
        await this.createTableIfNotExists();
      }

      // Start polling for updates
      this.startPolling();

      console.log(`✅ ${isMock ? 'Mock ' : ''}Azure Table Storage initialized successfully`);
    } catch (error) {
      console.error(`❌ Failed to initialize ${isMock ? 'Mock ' : ''}Azure Table Storage:`, error.message);
    }
  }

  /**
   * Initialize mock service for testing
   */
  initializeMockService() {
    this.tableClient = null; // Not used in mock mode
    this.mockData = new Map(); // In-memory storage for testing

    // Add test data for "koti" key
    this.mockData.set('koti', [{
      streamUrl: 'https://live.veo.co/stream/koti-test-stream@1234567890',
      timestamp: new Date().toISOString(),
      metadata: {
        partitionKey: 'koti',
        rowKey: 'test-row-1',
        testData: true,
        description: 'Test stream for koti key'
      }
    }]);

    // Add test data for the device ID as well
    this.mockData.set(this.deviceId, [{
      streamUrl: 'https://live.veo.co/stream/device-test-stream@1234567890',
      timestamp: new Date().toISOString(),
      metadata: {
        partitionKey: this.deviceId,
        rowKey: 'device-test-row-1',
        testData: true,
        description: 'Test stream for device'
      }
    }]);

    console.log('📊 Mock data initialized with test stream URLs');
    console.log(`   - "koti" key: ${this.mockData.get('koti')[0].streamUrl}`);
    console.log(`   - "${this.deviceId}" key: ${this.mockData.get(this.deviceId)[0].streamUrl}`);
  }

  /**
   * Create table if it doesn't exist
   */
  async createTableIfNotExists() {
    try {
      await this.tableClient.createTable();
      console.log(`📋 Created table: ${this.config.azure.tableName}`);
    } catch (error) {
      // Table already exists is expected
      if (!error.message.includes('TableAlreadyExists')) {
        throw error;
      }
    }
  }

  /**
   * Store a stream URL in the cloud with retry logic
   */
  async storeStreamUrl(streamUrl, metadata = {}) {
    const isMock = this.config.azure.storageConnectionString.includes('mock');
    const maxRetries = (this.config.azure && this.config.azure.retryAttempts) || 3;

    if (isMock) {
      // Mock implementation
      const timestamp = new Date().toISOString();
      const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      if (!this.mockData.has(this.deviceId)) {
        this.mockData.set(this.deviceId, []);
      }

      const entry = {
        streamUrl,
        timestamp,
        metadata: {
          partitionKey: this.deviceId,
          rowKey,
          ...metadata
        }
      };

      this.mockData.get(this.deviceId).unshift(entry); // Add to beginning for latest first

      console.log(`💾 [MOCK] Stored stream URL in cloud: ${streamUrl}`);
      return { success: true, timestamp };
    }

    if (!this.tableClient) {
      throw new Error('Azure Table Storage not initialized');
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const timestamp = new Date().toISOString();
        const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        await this.tableClient.createEntity({
          partitionKey: this.deviceId,
          rowKey,
          timestamp,
          streamUrl,
          ...metadata
        });

        console.log(`💾 Stored stream URL in cloud: ${streamUrl}`);
        return { success: true, timestamp };
      } catch (error) {
        console.error(`❌ Store attempt ${attempt} failed:`, error.message);

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * attempt, 10000); // Progressive delay, max 10s
          console.log(`🔄 Retrying in ${delay}ms...`);
          await this.sleep(delay);
        } else {
          console.error('❌ All store attempts failed');
          throw error;
        }
      }
    }
  }

  /**
   * Retrieve the latest stream URL from the cloud with retry logic
   * @param {string} key - The partition key to retrieve data for (defaults to device ID)
   */
  async getLatestStreamUrl(key = null) {
    const targetKey = key || this.deviceId;
    const maxRetries = (this.config.azure && this.config.azure.retryAttempts) || 3;

    // BBS HTTP endpoint
    if (this.useBbsHttp && this.bbsUrl) {
      try {
        const url = `${this.bbsUrl}/entries/${encodeURIComponent(targetKey)}`;

        const response = await NetworkUtils.httpRequest(url, {}, {
          maxRetries,
          timeoutMs: 10000,
          retryDelayMs: attempt => Math.min(1000 * attempt, 10000)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const entries = await response.json();

        if (entries && entries.length > 0) {
          // BBS returns entries sorted by timestamp (newest first)
          const latest = entries[0];
          console.log(`📖 [BBS HTTP] Retrieved latest stream URL for key "${targetKey}": ${latest.value1}`);

          return {
            streamUrl: latest.value1,
            timestamp: latest.timestamp,
            metadata: {
              value2: latest.value2,
              source: 'bbs-http'
            }
          };
        }

        console.log(`📖 [BBS HTTP] No entries found for key "${targetKey}"`);
        return null;
      } catch (error) {
        console.error('❌ All BBS HTTP retrieve attempts failed:', error.message);
        throw error;
      }
    }

    // Mock implementation
    const isMock = this.config.azure.storageConnectionString && this.config.azure.storageConnectionString.includes('mock');
    if (isMock) {
      const entries = this.mockData.get(targetKey);
      if (entries && entries.length > 0) {
        const latest = entries[0];
        console.log(`📖 [MOCK] Retrieved latest stream URL for key "${targetKey}": ${latest.streamUrl}`);
        return {
          streamUrl: latest.streamUrl,
          timestamp: latest.timestamp,
          metadata: latest.metadata
        };
      }
      console.log(`📖 [MOCK] No entries found for key "${targetKey}"`);
      return null;
    }

    // Azure Table Storage direct access
    if (!this.tableClient) {
      throw new Error('Azure Table Storage not initialized');
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const filter = `PartitionKey eq '${targetKey.replace(/'/g, "''")}'`;
        const results = [];

        for await (const entity of this.tableClient.listEntities({
          queryOptions: { filter }
        })) {
          results.push({
            streamUrl: entity.streamUrl,
            timestamp: entity.timestamp,
            metadata: {
              partitionKey: entity.partitionKey,
              rowKey: entity.rowKey
            }
          });

          if (results.length >= 10) break;
        }

        if (results.length > 0) {
          results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          return results[0];
        }

        return null;
      } catch (error) {
        console.error(`❌ Retrieve attempt ${attempt} failed:`, error.message);

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * attempt, 10000);
          console.log(`🔄 Retrying in ${delay}ms...`);
          await this.sleep(delay);
        } else {
          console.error('❌ All retrieve attempts failed');
          throw error;
        }
      }
    }
  }

  /**
   * Retrieve click coordinates from the cloud
   */
  async getCoordinates() {
    const maxRetries = (this.config.azure && this.config.azure.retryAttempts) || 3;

    if (this.useBbsHttp && this.bbsUrl) {
      try {
          const url = `${this.bbsUrl}/config/coordinates`;

          const response = await NetworkUtils.httpRequest(url, {}, {
            maxRetries,
            timeoutMs: 10000,
            retryDelayMs: attempt => Math.min(1000 * attempt, 10000)
          });
          
          if (!response.ok) {
            console.warn(`⚠️ BBS HTTP coordinates fetch failed (Status: ${response.status})`);
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const coordinates = await response.json();
          if (!coordinates || typeof coordinates !== 'object' || Object.keys(coordinates).length === 0) {
            console.warn('⚠️ BBS HTTP returned empty or invalid coordinates');
            return null;
          }

          console.log('📍 [BBS HTTP] Retrieved coordinates from cloud');
          return coordinates;
        } catch (error) {
          console.error('❌ All BBS HTTP coordinates retrieve attempts failed:', error.message);
          return null; // Fallback to local if possible, but user wants centralized
      }
      }
    }
    return null;
  }

  /**
   * Start polling for stream URL updates
   */
  startPolling() {
    if (this.isPolling) {
      console.log('🔄 Polling already running');
      return;
    }

    this.isPolling = true;
    console.log(`🔄 Starting cloud polling (interval: ${this.config.azure.pollInterval}ms)`);

    this.pollInterval = setInterval(async () => {
      await this.checkForUpdates();
    }, this.config.azure.pollInterval);

    // Check immediately
    this.checkForUpdates();
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
    console.log('⏹️ Cloud polling stopped');
  }

  /**
   * Check for stream URL updates from the cloud with error handling
   */
  async checkForUpdates() {
    try {
      const latestEntry = await this.getLatestStreamUrl();

      if (latestEntry && latestEntry.streamUrl !== this.lastStreamUrl) {
        console.log(`🌐 New stream URL detected: ${latestEntry.streamUrl}`);
        this.lastStreamUrl = latestEntry.streamUrl;

        if (this.onStreamUpdateCallback) {
          try {
            await this.onStreamUpdateCallback(latestEntry.streamUrl, latestEntry);
          } catch (callbackError) {
            console.error('❌ Error in stream update callback:', callbackError.message);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error checking for updates:', error.message);

      // Continue polling even if one check fails
      // Only stop polling on critical initialization errors
      if (error.message.includes('not initialized') || error.message.includes('connection')) {
        console.log('🔄 Critical error detected, continuing to poll...');
      }
    }
  }

  /**
   * Set callback for stream URL updates
   */
  onStreamUpdate(callback) {
    this.onStreamUpdateCallback = callback;
  }

  /**
   * Get cloud service status
   */
  getStatus() {
    return {
      enabled: !!(this.config.azure && this.config.azure.enabled),
      initialized: !!this.tableClient,
      polling: this.isPolling,
      lastStreamUrl: this.lastStreamUrl,
      pollInterval: (this.config.azure && this.config.azure.pollInterval) || null,
      deviceId: this.deviceId
    };
  }

  /**
   * Sleep utility method
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopPolling();
    this.tableClient = null;
  }
}

module.exports = CloudService;
