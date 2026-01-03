#!/usr/bin/env node

const { IotHubClient } = require('@azure/arm-iothub');
const { Registry, Client: IoTHubServiceClient, AmqpWs } = require('azure-iothub');
const { Message } = require('azure-iot-common');

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
    this.isInitialized = false;
  }

  async initialize() {
    if (!this.subscriptionId || !this.resourceGroup || !this.iotHubName) {
      console.warn('⚠️ IoT Hub configuration incomplete, running in mock mode');
      this.mockMode = true;
      return;
    }

    try {
      console.log(`🔄 Initializing IoT Hub Service for ${this.iotHubName}...`);
      
      // 1. Initialize Management Client
      this.armClient = new IotHubClient(this.credentials, this.subscriptionId);
      
      // 2. Bootstrap: Get IoT Hub Connection String using Managed Identity
      const connectionString = await this._getHubConnectionString();
      console.log('✅ Connection string retrieved from ARM');
      
      // 3. Initialize Data Plane Clients
      this.registry = Registry.fromConnectionString(connectionString);
      this.serviceClient = IoTHubServiceClient.fromConnectionString(connectionString, AmqpWs);
      
      this.isInitialized = true;
      console.log('✅ IoT Hub Registry and Service clients ready');
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

    try {
      console.log(`📤 Preparing to send command "${command}" to device ${deviceId}`);
      
      if (!this.isInitialized || !this.serviceClient) {
        throw new Error('IoT Hub Service Client not initialized. Check if ARM credentials/permissions are correct.');
      }

      const messageData = JSON.stringify({ 
        command, 
        payload, 
        timestamp: new Date().toISOString()
      });
      
      // Use Buffer to ensure correct AMQP encoding by rhea
      const message = new Message(Buffer.from(messageData, 'utf8'));

      return new Promise((resolve, reject) => {
        // Set a 15 second timeout for the Azure call
        const timeout = setTimeout(() => {
          console.error(`⏱️ Timeout sending command to ${deviceId} after 15s`);
          reject(new Error('IoT Hub send operation timed out'));
        }, 15000);

        this.serviceClient.send(deviceId, message, (err, res) => {
          clearTimeout(timeout);
          if (err) {
            console.error(`❌ IoT Hub send error for ${deviceId}:`, err);
            reject(err);
          } else {
            console.log(`✅ IoT Hub send successful for ${deviceId}`);
            resolve({ messageId: message.messageId, result: res });
          }
        });
      });
    } catch (error) {
      console.error(`❌ Failed to create or send IoT command:`, error.message);
      throw error;
    }
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