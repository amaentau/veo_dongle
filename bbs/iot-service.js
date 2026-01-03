#!/usr/bin/env node

const { IoTHubTokenCredentials } = require('@azure/arm-iothub');
const { IotHubClient } = require('@azure/arm-iothub');

/**
 * IoT Hub Service for device registration and management
 */
class IoTHubService {
  constructor(subscriptionId, resourceGroup, iotHubName, credentials) {
    this.subscriptionId = subscriptionId;
    this.resourceGroup = resourceGroup;
    this.iotHubName = iotHubName;
    this.credentials = credentials;
    this.client = null;
  }

  async initialize() {
    if (!this.subscriptionId || !this.resourceGroup || !this.iotHubName) {
      console.warn('⚠️ IoT Hub configuration incomplete, running in mock mode');
      this.mockMode = true;
      return;
    }

    try {
      this.client = new IotHubClient(this.credentials, this.subscriptionId);
      console.log('✅ IoT Hub client initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize IoT Hub client:', error.message);
      console.warn('⚠️ Falling back to mock mode');
      this.mockMode = true;
    }
  }

  /**
   * Register a device with IoT Hub
   * @param {string} deviceId - The device ID to register
   * @returns {object} Device registration result with connection string
   */
  async registerDevice(deviceId) {
    if (this.mockMode) {
      return this._mockRegisterDevice(deviceId);
    }

    try {
      // Check if device already exists
      let device;
      try {
        device = await this.client.iotHubResource.getDevice(
          this.resourceGroup,
          this.iotHubName,
          deviceId
        );
        console.log(`📱 Device ${deviceId} already exists in IoT Hub`);
      } catch (error) {
        if (error.statusCode !== 404) {
          throw error;
        }

        // Device doesn't exist, create it
        console.log(`📱 Creating new device ${deviceId} in IoT Hub`);
        const deviceDescription = {
          deviceId: deviceId,
          status: 'enabled',
          capabilities: {
            iotEdge: false
          }
        };

        device = await this.client.iotHubResource.createOrUpdateDevice(
          this.resourceGroup,
          this.iotHubName,
          deviceId,
          deviceDescription
        );
        console.log(`✅ Device ${deviceId} created successfully`);
      }

      // Generate connection string
      const connectionString = this._generateConnectionString(device);

      return {
        success: true,
        deviceId: deviceId,
        connectionString: connectionString,
        status: device.status,
        created: true // This is a new registration
      };

    } catch (error) {
      console.error(`❌ Failed to register device ${deviceId}:`, error.message);
      throw new Error(`Device registration failed: ${error.message}`);
    }
  }

  /**
   * Generate device connection string from device info
   * @param {object} device - Device object from IoT Hub
   * @returns {string} Connection string
   */
  _generateConnectionString(device) {
    const hostName = `${this.iotHubName}.azure-devices.net`;
    const deviceId = device.deviceId;
    const key = device.authentication.symmetricKey.primaryKey;

    return `HostName=${hostName};DeviceId=${deviceId};SharedAccessKey=${key}`;
  }

  /**
   * Mock device registration for testing without Azure
   * @param {string} deviceId - The device ID to register
   * @returns {object} Mock device registration result
   */
  _mockRegisterDevice(deviceId) {
    console.log(`🧪 [MOCK] Registering device ${deviceId}`);

    // Generate a mock connection string
    const mockKey = Buffer.from(`mock-key-${deviceId}`).toString('base64');
    const connectionString = `HostName=espa-tv-iot-hub.azure-devices.net;DeviceId=${deviceId};SharedAccessKey=${mockKey}`;

    return {
      success: true,
      deviceId: deviceId,
      connectionString: connectionString,
      status: 'enabled',
      mock: true
    };
  }

  /**
   * Get device information
   * @param {string} deviceId - The device ID to query
   * @returns {object} Device information
   */
  async getDevice(deviceId) {
    if (this.mockMode) {
      return {
        deviceId: deviceId,
        status: 'enabled',
        connectionState: 'Connected',
        mock: true
      };
    }

    try {
      const device = await this.client.iotHubResource.getDevice(
        this.resourceGroup,
        this.iotHubName,
        deviceId
      );

      return {
        deviceId: device.deviceId,
        status: device.status,
        connectionState: device.connectionState,
        lastActivityTime: device.lastActivityTime
      };
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`Device ${deviceId} not found`);
      }
      throw error;
    }
  }

  /**
   * Send command to device via IoT Hub
   * @param {string} deviceId - The target device ID
   * @param {string} command - The command to send
   * @param {object} payload - Optional command payload
   */
  async sendCommandToDevice(deviceId, command, payload = {}) {
    if (this.mockMode) {
      console.log(`🧪 [MOCK] Sending command "${command}" to device ${deviceId}`);
      return {
        messageId: `mock-${Date.now()}`,
        deliveryCount: 1
      };
    }

    if (!this.client) {
      throw new Error('IoT Hub client not initialized');
    }

    try {
      // Import Message from azure-iothub
      const { Message } = require('azure-iothub');

      const messageData = {
        command: command,
        payload: payload,
        timestamp: new Date().toISOString(),
        source: 'bbs-service'
      };

      const message = new Message(JSON.stringify(messageData));
      message.messageId = `${command}-${deviceId}-${Date.now()}`;
      message.ack = 'full'; // Wait for delivery confirmation

      // Send the message
      const result = await new Promise((resolve, reject) => {
        this.client.send(deviceId, message, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      console.log(`📤 Command "${command}" sent to device ${deviceId}, message ID: ${message.messageId}`);
      return result;

    } catch (error) {
      console.error(`❌ Failed to send command to device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Remove device from IoT Hub
   * @param {string} deviceId - The device ID to remove
   */
  async removeDevice(deviceId) {
    if (this.mockMode) {
      console.log(`🧪 [MOCK] Removed device ${deviceId}`);
      return { success: true, mock: true };
    }

    try {
      await this.client.iotHubResource.deleteDevice(
        this.resourceGroup,
        this.iotHubName,
        deviceId
      );
      console.log(`🗑️ Device ${deviceId} removed from IoT Hub`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Failed to remove device ${deviceId}:`, error.message);
      throw error;
    }
  }
}

module.exports = IoTHubService;
