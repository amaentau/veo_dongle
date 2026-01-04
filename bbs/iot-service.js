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
      
      this.armClient = new IotHubClient(this.credentials, this.subscriptionId);
      const connectionString = await this._getHubConnectionString();
      
      this.registry = Registry.fromConnectionString(connectionString);
      this.serviceClient = IoTHubServiceClient.fromConnectionString(connectionString, AmqpWs);
      
      this.isInitialized = true;
      console.log('✅ IoT Hub Registry and Service clients ready');
    } catch (error) {
      console.error('❌ Failed to initialize IoT Hub clients:', error.message);
      this.mockMode = true;
    }
  }

  async _getHubConnectionString() {
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
   * Send command to device using Direct Methods (Low Latency)
   */
  async sendCommandToDevice(deviceId, command, payload = {}) {
    if (this.mockMode) {
      console.log(`🧪 [MOCK] Sending command "${command}" to device ${deviceId}`);
      return { success: true, messageId: `mock-${Date.now()}` };
    }

    if (!this.isInitialized || !this.serviceClient) {
      throw new Error('IoT Hub Service Client not initialized.');
    }

    try {
      console.log(`⚡ Attempting Direct Method "${command}" for device ${deviceId}...`);
      
      const methodParams = {
        methodName: command,
        payload: payload,
        responseTimeoutInSeconds: 15, // Wait up to 15s for the device to respond
        connectTimeoutInSeconds: 5    // Wait up to 5s for the connection to be established
      };

      try {
        const response = await this.serviceClient.invokeDeviceMethod(deviceId, methodParams);
        console.log(`✅ Direct Method "${command}" successful. Status: ${response.result.status}`);
        return { 
          success: true, 
          methodStatus: response.result.status, 
          payload: response.result.payload 
        };
      } catch (methodErr) {
        // If the device is offline or doesn't support direct methods, fall back to C2D
        console.warn(`⚠️ Direct Method failed (${methodErr.message}). Falling back to C2D...`);
        return await this._sendC2DMessage(deviceId, command, payload);
      }
    } catch (error) {
      console.error(`❌ Failed to send IoT command to ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Fallback: Send command as Cloud-to-Device (C2D) message
   */
  async _sendC2DMessage(deviceId, command, payload) {
    console.log(`📨 Sending C2D message fallback for "${command}" to ${deviceId}`);
    
    const messageData = JSON.stringify({ 
      command, 
      payload, 
      timestamp: new Date().toISOString()
    });
    
    const message = new Message(Buffer.from(messageData, 'utf8'));
    message.ack = 'none';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('C2D timeout')), 15000);

      this.serviceClient.send(deviceId, message, (err, res) => {
        clearTimeout(timeout);
        if (err) {
          console.error(`❌ C2D send error:`, err);
          reject(err);
        } else {
          console.log(`✅ C2D message queued for ${deviceId}`);
          resolve({ success: true, messageId: message.messageId, mode: 'c2d' });
        }
      });
    });
  }

  async registerDevice(deviceId) {
    if (this.mockMode) return this._mockRegisterDevice(deviceId);
    try {
      let deviceResponse;
      try {
        const response = await this.registry.get(deviceId);
        deviceResponse = response.responseBody;
      } catch (error) {
        const deviceDescription = { deviceId, status: 'enabled' };
        const response = await this.registry.create(deviceDescription);
        deviceResponse = response.responseBody;
      }
      const connectionString = `HostName=${this.iotHubName}.azure-devices.net;DeviceId=${deviceId};SharedAccessKey=${deviceResponse.authentication.symmetricKey.primaryKey}`;
      return { success: true, deviceId, connectionString, status: deviceResponse.status };
    } catch (error) {
      console.error(`❌ Failed to register device ${deviceId}:`, error.message);
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
    return { success: true, deviceId, connectionString: `HostName=mock.azure-devices.net;DeviceId=${deviceId};SharedAccessKey=${mockKey}`, status: 'enabled', mock: true };
  }
}

module.exports = IoTHubService;
