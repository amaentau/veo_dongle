#!/usr/bin/env node

const { Client, Message } = require('azure-iot-device');
const { Mqtt } = require('azure-iot-device-mqtt');

/**
 * IoT Hub Device Service for Raspberry Pi
 * Handles cloud-to-device commands from BBS/IoT Hub
 */
class IoTDeviceService {
  constructor(deviceId, hubName = null, sasToken = null, connectionString = null) {
    this.deviceId = deviceId;
    this.hubName = hubName;
    this.sasToken = sasToken;
    this.connectionString = connectionString; // Fallback for backward compatibility
    this.client = null;
    this.isConnected = false;
    this.onCommandCallback = null;
    this.commandHistory = [];
    this.maxHistorySize = 50;

    console.log(`🔗 IoT Device Service initialized for device: ${deviceId}`);
  }

  /**
   * Connect to IoT Hub
   */
  async connect() {
    if (!this.connectionString && (!this.hubName || !this.sasToken)) {
      console.log('⚠️ No IoT Hub connection credentials available - IoT commands disabled');
      return false;
    }

    try {
      console.log('🔗 Connecting to IoT Hub...');

      if (this.connectionString) {
        // Backward compatibility: use full connection string
        this.client = Client.fromConnectionString(this.connectionString, Mqtt);
      } else {
        // New secure method: use hub name + SAS token
        const connectionString = `HostName=${this.hubName}.azure-devices.net;DeviceId=${this.deviceId};SharedAccessSignature=${this.sasToken}`;
        this.client = Client.fromConnectionString(connectionString, Mqtt);
      }

      // Set up event handlers
      this.client.on('connect', () => {
        console.log('✅ Connected to IoT Hub');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        console.log('⚠️ Disconnected from IoT Hub');
        this.isConnected = false;
      });

      this.client.on('error', (err) => {
        console.error('❌ IoT Hub client error:', err.message);
        this.isConnected = false;
      });

      // Set up cloud-to-device message handler
      this.client.on('message', this._handleCloudMessage.bind(this));

      // Connect
      await this.client.open();
      console.log('🎯 IoT Hub device ready to receive commands');
      return true;

    } catch (error) {
      console.error('❌ Failed to connect to IoT Hub:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Disconnect from IoT Hub
   */
  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.close();
        console.log('👋 Disconnected from IoT Hub');
      } catch (error) {
        console.error('❌ Error disconnecting from IoT Hub:', error.message);
      }
    }
    this.isConnected = false;
  }

  /**
   * Handle incoming cloud-to-device messages
   */
  async _handleCloudMessage(msg) {
    try {
      const messageData = msg.data.toString('utf8');
      let command;

      try {
        command = JSON.parse(messageData);
      } catch (parseError) {
        // Handle non-JSON messages (legacy support)
        command = { command: messageData };
      }

      console.log(`📨 Received IoT command: ${command.command}`, command.payload || '');

      // Add to command history
      this._addToHistory({
        timestamp: new Date().toISOString(),
        command: command.command,
        payload: command.payload,
        source: 'iot-hub'
      });

      // Execute the command
      let result = { success: false, error: 'No command handler registered' };

      if (this.onCommandCallback) {
        try {
          result = await this.onCommandCallback(command.command, command.payload);
        } catch (executeError) {
          result = { success: false, error: executeError.message };
          console.error('❌ Command execution error:', executeError.message);
        }
      }

      // Send acknowledgment back to IoT Hub
      await this._sendCommandResponse(msg, result);

      // Complete the message
      this.client.complete(msg);

      console.log(`✅ Command ${command.command} processed: ${result.success ? 'SUCCESS' : 'FAILED'}`);

    } catch (error) {
      console.error('❌ Error handling IoT message:', error.message);
      // Reject the message if processing failed
      if (this.client) {
        this.client.reject(msg);
      }
    }
  }

  /**
   * Send command execution result back to IoT Hub
   */
  async _sendCommandResponse(originalMsg, result) {
    try {
      const response = {
        commandId: originalMsg.messageId,
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        result: result
      };

      const responseMessage = new Message(JSON.stringify(response));
      responseMessage.properties.add('command-response', 'true');
      responseMessage.messageId = `resp-${originalMsg.messageId}-${Date.now()}`;

      await this.client.sendEvent(responseMessage);
      console.log('📤 Command response sent to IoT Hub');

    } catch (error) {
      console.error('❌ Failed to send command response:', error.message);
    }
  }

  /**
   * Set callback for handling commands
   */
  onCommand(callback) {
    this.onCommandCallback = callback;
  }

  /**
   * Send device telemetry to IoT Hub
   */
  async sendTelemetry(data) {
    if (!this.isConnected || !this.client) {
      console.log('⚠️ Cannot send telemetry - not connected to IoT Hub');
      return false;
    }

    try {
      const telemetryMessage = new Message(JSON.stringify({
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        ...data
      }));

      await this.client.sendEvent(telemetryMessage);
      console.log('📊 Telemetry sent to IoT Hub');
      return true;

    } catch (error) {
      console.error('❌ Failed to send telemetry:', error.message);
      return false;
    }
  }

  /**
   * Update device twin reported properties
   */
  async updateReportedProperties(properties) {
    if (!this.isConnected || !this.client) {
      console.log('⚠️ Cannot update twin - not connected to IoT Hub');
      return false;
    }

    try {
      const patch = {
        deviceId: this.deviceId,
        lastUpdate: new Date().toISOString(),
        ...properties
      };

      await new Promise((resolve, reject) => {
        this.client.getTwin((err, twin) => {
          if (err) {
            reject(err);
            return;
          }

          twin.properties.reported.update(patch, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });

      console.log('📝 Device twin updated');
      return true;

    } catch (error) {
      console.error('❌ Failed to update device twin:', error.message);
      return false;
    }
  }

  /**
   * Get recent command history
   */
  getCommandHistory(limit = 10) {
    return this.commandHistory.slice(-limit);
  }

  /**
   * Add command to history
   */
  _addToHistory(commandEntry) {
    this.commandHistory.push(commandEntry);
    if (this.commandHistory.length > this.maxHistorySize) {
      this.commandHistory.shift(); // Remove oldest
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      deviceId: this.deviceId,
      hasConnectionString: !!this.connectionString,
      commandHistorySize: this.commandHistory.length,
      lastCommand: this.commandHistory.length > 0 ? this.commandHistory[this.commandHistory.length - 1] : null
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    await this.disconnect();
    this.client = null;
    this.onCommandCallback = null;
  }
}

module.exports = IoTDeviceService;
