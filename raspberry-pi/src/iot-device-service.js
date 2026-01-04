#!/usr/bin/env node

const { Client, Message } = require('azure-iot-device');
const { Mqtt } = require('azure-iot-device-mqtt');

/**
 * IoT Hub Device Service for Raspberry Pi
 * Handles cloud-to-device commands from BBS/IoT Hub using Direct Methods (primary)
 * and Cloud-to-Device messages (fallback).
 */
class IoTDeviceService {
  constructor(deviceId, hubName = null, sasToken = null, connectionString = null) {
    this.deviceId = deviceId;
    this.hubName = hubName;
    this.sasToken = sasToken;
    this.connectionString = connectionString;
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
        this.client = Client.fromConnectionString(this.connectionString, Mqtt);
      } else {
        const connectionString = `HostName=${this.hubName}.azure-devices.net;DeviceId=${this.deviceId};SharedAccessSignature=${this.sasToken}`;
        this.client = Client.fromConnectionString(connectionString, Mqtt);
      }

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

      // Direct Method Handlers
      const methods = ['play', 'pause', 'fullscreen', 'restart', 'status'];
      methods.forEach(method => {
        this.client.onDeviceMethod(method, (req, res) => this._onDirectMethod(method, req, res));
      });

      // Fallback C2D
      this.client.on('message', this._handleCloudMessage.bind(this));

      await this.client.open();
      console.log('🎯 IoT Hub device ready (Direct Methods + C2D Fallback)');
      return true;

    } catch (error) {
      console.error('❌ Failed to connect to IoT Hub:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Universal Direct Method Handler with Fast-Path support
   */
  async _onDirectMethod(methodName, request, response) {
    const startTime = Date.now();
    console.log(`⚡ Direct Method received: ${methodName}`);

    this._addToHistory({
      timestamp: new Date().toISOString(),
      command: methodName,
      payload: request.payload,
      source: 'direct-method'
    });

    if (!this.onCommandCallback) {
      response.send(501, { error: 'No handler registered' }, (err) => {
        if (err) console.error('❌ Failed to send 501:', err.message);
      });
      return;
    }

    // "Fast-Path" strategy:
    // We send the 200 OK acknowledgement IMMEDIATELY for UI responsiveness,
    // then continue executing the browser automation in the background.
    const fastPathMethods = ['play', 'pause', 'fullscreen'];
    const isFastPath = fastPathMethods.includes(methodName);

    if (isFastPath) {
      // Send acknowledgement immediately
      response.send(200, { success: true, mode: 'fast-path', status: 'Acknowledged' }, (err) => {
        if (err) console.error('❌ Failed to send FastPath ack:', err.message);
        else console.log(`✅ Direct Method '${methodName}' acknowledged (Fast-Path) in ${Date.now() - startTime}ms`);
      });

      // Execute in background
      this.onCommandCallback(methodName, request.payload).catch(err => {
        console.error(`❌ Background command '${methodName}' failed:`, err.message);
      });
    } else {
      // Regular path for status/restart where we want to wait for the actual result
      try {
        const result = await this.onCommandCallback(methodName, request.payload);
        const status = result.success ? 200 : 400;
        response.send(status, result, (err) => {
          if (err) console.error('❌ Failed to send response:', err.message);
          else console.log(`✅ Direct Method '${methodName}' finished in ${Date.now() - startTime}ms`);
        });
      } catch (error) {
        response.send(500, { success: false, error: error.message }, (err) => {
          if (err) console.error('❌ Failed to send 500:', err.message);
        });
      }
    }
  }

  async _handleCloudMessage(msg) {
    try {
      const messageData = msg.data.toString('utf8');
      let command;
      try {
        command = JSON.parse(messageData);
      } catch (e) {
        command = { command: messageData };
      }

      console.log(`📨 Received C2D command: ${command.command}`);

      this._addToHistory({
        timestamp: new Date().toISOString(),
        command: command.command,
        payload: command.payload,
        source: 'c2d'
      });

      if (this.onCommandCallback) {
        // C2D is already asynchronous by nature (queued)
        this.onCommandCallback(command.command, command.payload).catch(err => {
          console.error(`❌ C2D command '${command.command}' failed:`, err.message);
        });
      }

      this.client.complete(msg, (err) => {
        if (err) console.error('❌ Failed to complete C2D:', err.message);
      });
    } catch (error) {
      console.error('❌ Error handling C2D:', error.message);
      if (this.client) this.client.reject(msg);
    }
  }

  logDebug(...args) {
    if (process.env.DEBUG === 'true') console.log('[DEBUG]', ...args);
  }

  onCommand(callback) {
    this.onCommandCallback = callback;
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.close();
      } catch (error) {
        console.error('❌ Error disconnecting:', error.message);
      }
    }
    this.isConnected = false;
  }

  async sendTelemetry(data) {
    if (!this.isConnected || !this.client) return false;
    try {
      const msg = new Message(JSON.stringify({ deviceId: this.deviceId, timestamp: new Date().toISOString(), ...data }));
      await this.client.sendEvent(msg);
      return true;
    } catch (error) {
      return false;
    }
  }

  _addToHistory(entry) {
    this.commandHistory.push(entry);
    if (this.commandHistory.length > this.maxHistorySize) this.commandHistory.shift();
  }

  getStatus() {
    return {
      connected: this.isConnected,
      deviceId: this.deviceId,
      lastCommand: this.commandHistory.length > 0 ? this.commandHistory[this.commandHistory.length - 1] : null
    };
  }
}

module.exports = IoTDeviceService;
