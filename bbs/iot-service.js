#!/usr/bin/env node

const { IotHubClient } = require('@azure/arm-iothub');
const { Registry, Client: IoTHubServiceClient } = require('azure-iothub');

/**
 * IoT Hub Service for device registration and management
 */
class IoTHubService {
  constructor(subscriptionId, resourceGroup, iotHubName, credentials) {
    this.subscriptionId = subscriptionId;
    this.resourceGroup = resourceGroup;
    this.iotHubName = iotHubName;
    this.credentials = credentials;
    this.armClient = null;
    this.registry = null;
    this.serviceClient = null;
    this.mockMode = false;
  }

  async initialize() {
    if (!this.subscriptionId || !this.resourceGroup || !this.iotHubName) {
      console.warn('⚠️ IoT Hub configuration incomplete, running in mock mode');
      this.mockMode = true;
      return;
    }

    try {
      // 1. Initialize Management Client
      this.armClient = new IotHubClient(this.credentials, this.subscriptionId);
      console.log('✅ ARM Client initialized');

      // 2. Bootstrap: Get IoT Hub Connection String using Managed Identity
      const connectionString = await this._getHubConnectionString();
      
      // 3. Initialize Data Plane Clients
      this.registry = Registry.fromConnectionString(connectionString);
      this.serviceClient = IoTHubServiceClient.fromConnectionString(connectionString);
      
      console.log('✅ IoT Hub Registry and Service clients initialized');
    } catch (error) {
      console.error('❌ Failed to initialize IoT Hub clients:', error.message);
      console.warn('⚠️ Falling back to mock mode');
      this.mockMode = true;
    }
  }

  /**
   * Internal: Get Hub connection string via ARM API
   */
  async _getHubConnectionString() {
    // List keys for the IoT Hub
    const keys = [];
    const iter = this.armClient.iotHubResource.listKeys(this.resourceGroup, this.iotHubName);
    for await (const key of iter) {
      keys.push(key);
    }

    const ownerKey = keys.find(k => k.keyName === 'iothubowner');
    if (!ownerKey) throw new Error('Could not find iothubowner key');

    return `HostName=${this.iotHubName}.azure-devices.net;SharedAccessKeyName=iothubowner;SharedAccessKey=${ownerKey.primaryKey}`;
  }

  /**
   * Register a device with IoT Hub
   */
  async registerDevice(deviceId) {
    if (this.mockMode) return this._mockRegisterDevice(deviceId);

    try {
      let deviceResponse;
      try {
        // Check if device exists
        const response = await this.registry.get(deviceId);
        deviceResponse = response.responseBody;
        console.log(`📱 Device ${deviceId} already exists in IoT Hub`);
      } catch (error) {
        // Device doesn't exist, create it
        console.log(`📱 Creating new device ${deviceId} in IoT Hub`);
        const deviceDescription = {
          deviceId: deviceId,
          status: 'enabled'
        };
        const response = await this.registry.create(deviceDescription);
        deviceResponse = response.responseBody;
        console.log(`✅ Device ${deviceId} created successfully`);
      }

      const connectionString = `HostName=${this.iotHubName}.azure-devices.net;DeviceId=${deviceId};SharedAccessKey=${deviceResponse.authentication.symmetricKey.primaryKey}`;

      return {
        success: true,
        deviceId: deviceId,
        connectionString: connectionString,
        status: deviceResponse.status,
        created: true
      };
    } catch (error) {
      console.error(`❌ Failed to register device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Send command to device
   */
  async sendCommandToDevice(deviceId, command, payload = {}) {
    if (this.mockMode) {
      console.log(`🧪 [MOCK] Sending command "${command}" to device ${deviceId}`);
      return { messageId: `mock-${Date.now()}` };
    }

    const { Message } = require('azure-iothub');
    const messageData = JSON.stringify({ command, payload, timestamp: new Date().toISOString() });
    const message = new Message(messageData);
    message.ack = 'full';
    message.messageId = `${command}-${Date.now()}`;

    return new Promise((resolve, reject) => {
      this.serviceClient.send(deviceId, message, (err, res) => {
        if (err) reject(err);
        else resolve({ messageId: message.messageId, result: res });
      });
    });
  }

  async getDevice(deviceId) {
    if (this.mockMode) return { deviceId, status: 'enabled', connectionState: 'Disconnected' };
    const response = await this.registry.get(deviceId);
    return response.responseBody;
  }

  _mockRegisterDevice(deviceId) {
    const mockKey = Buffer.from(`mock-key-${deviceId}`).toString('base64');
    return {
      success: true,
      deviceId: deviceId,
      connectionString: `HostName=mock.azure-devices.net;DeviceId=${deviceId};SharedAccessKey=${mockKey}`,
      status: 'enabled',
      mock: true
    };
  }
}

module.exports = IoTHubService;