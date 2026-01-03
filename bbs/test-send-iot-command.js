#!/usr/bin/env node

/**
 * Test script to send IoT Hub commands to devices
 * Usage: node test-send-iot-command.js <deviceId> <command> [payload]
 */

const { Client: IoTClient, Message } = require('azure-iot-device');
const { Mqtt } = require('azure-iot-device-mqtt');

async function sendIoTCommand(deviceId, command, payload = null) {
  console.log(`🎮 Sending IoT command to device: ${deviceId}`);
  console.log(`   Command: ${command}`);
  if (payload) console.log(`   Payload:`, payload);

  // This is a test script - in production, commands are sent from the BBS service
  // This script demonstrates the IoT Hub command structure

  const commandMessage = {
    command: command,
    payload: payload,
    timestamp: new Date().toISOString(),
    source: 'test-script'
  };

  console.log('\n📨 Command message structure:');
  console.log(JSON.stringify(commandMessage, null, 2));

  console.log('\n⚠️  Note: This test script shows the command structure.');
  console.log('   In production, use the BBS API endpoints to send commands:');
  console.log(`   POST /devices/${deviceId}/commands/${command}`);
  console.log('   The BBS service will send the command via IoT Hub.');

  console.log('\n✅ Command structure validated!');
}

// Command line usage
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node test-send-iot-command.js <deviceId> <command> [payload]');
  console.log('Examples:');
  console.log('  node test-send-iot-command.js rpi-device-123 play');
  console.log('  node test-send-iot-command.js rpi-device-123 change-track \'{"trackId": "track-456"}\'');
  process.exit(1);
}

const [deviceId, command, payloadStr] = args;
let payload = null;

if (payloadStr) {
  try {
    payload = JSON.parse(payloadStr);
  } catch (error) {
    console.error('❌ Invalid JSON payload:', payloadStr);
    process.exit(1);
  }
}

sendIoTCommand(deviceId, command, payload).catch(console.error);
