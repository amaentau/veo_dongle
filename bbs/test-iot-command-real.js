#!/usr/bin/env node

/**
 * Diagnostic script for IoT Hub command delivery
 * Usage: node test-iot-command-real.js <deviceId> <command> [payload_json]
 */

const IoTHubService = require('./iot-service');
const { DefaultAzureCredential } = require('@azure/identity');
require('dotenv').config();

async function runDiagnostics() {
  const deviceId = process.argv[2];
  const command = process.argv[3] || 'play';
  const payloadStr = process.argv[4];

  if (!deviceId) {
    console.error('❌ Error: Device ID is required');
    console.log('Usage: node test-iot-command-real.js <deviceId> <command> [payload_json]');
    process.exit(1);
  }

  let payload = {};
  if (payloadStr) {
    try {
      payload = JSON.parse(payloadStr);
    } catch (e) {
      console.error('❌ Error: Invalid payload JSON:', payloadStr);
      process.exit(1);
    }
  }

  const subscriptionId = process.env.IOT_HUB_SUBSCRIPTION_ID;
  const resourceGroup = process.env.IOT_HUB_RESOURCE_GROUP || 'EspaTvResourceGroup';
  const iotHubName = process.env.IOT_HUB_NAME || 'espa-tv-iot-hub';

  console.log('🔍 Starting IoT Command Diagnostics...');
  console.log('--------------------------------------');
  console.log(`📍 Device: ${deviceId}`);
  console.log(`📍 Command: ${command}`);
  console.log(`📍 IoT Hub: ${iotHubName}`);
  console.log(`📍 Resource Group: ${resourceGroup}`);
  console.log(`📍 Subscription: ${subscriptionId || 'NOT SET'}`);
  console.log('--------------------------------------');

  if (!subscriptionId) {
    console.error('❌ Error: IOT_HUB_SUBSCRIPTION_ID environment variable is missing.');
    console.log('Make sure you have a .env file or environment variables set.');
    process.exit(1);
  }

  const iotService = new IoTHubService(
    subscriptionId,
    resourceGroup,
    iotHubName,
    new DefaultAzureCredential()
  );

  try {
    console.log('🔄 Initializing IoT Hub Service...');
    await iotService.initialize();
    
    if (iotService.mockMode) {
      console.warn('⚠️ Service is running in MOCK MODE. Real commands will not be sent.');
      console.warn('Check if ARM credentials/permissions are correct.');
    }

    console.log(`🔄 Checking device ${deviceId} status in IoT Hub...`);
    const device = await iotService.getDevice(deviceId);
    console.log(`✅ Device found: status=${device.status}, state=${device.connectionState}`);
    
    if (device.connectionState !== 'Connected') {
      console.warn('⚠️ Warning: Device is NOT CONNECTED. Commands will be queued in IoT Hub.');
    }

    console.log(`🚀 Sending command "${command}" to ${deviceId}...`);
    const result = await iotService.sendCommandToDevice(deviceId, command, payload);
    
    console.log('--------------------------------------');
    console.log('✅ COMMAND SENT SUCCESSFULLY');
    console.log('   Message ID:', result.messageId);
    console.log('   IoT Hub Result:', JSON.stringify(result.result || 'Sent'));
    console.log('--------------------------------------');
    console.log('Check the Raspberry Pi logs to see if it received the message.');

  } catch (error) {
    console.error('--------------------------------------');
    console.error('❌ COMMAND FAILED');
    console.error('   Error Message:', error.message);
    if (error.code) console.error('   Error Code:', error.code);
    if (error.stack) console.error('   Trace:', error.stack);
    console.error('--------------------------------------');
    
    console.log('\n💡 Troubleshooting Tips:');
    console.log('1. Check if the Managed Identity has "IoT Hub Data Contributor" role.');
    console.log('2. Verify IOT_HUB_NAME and other env vars are exactly correct.');
    console.log('3. Ensure the device is registered in the correct IoT Hub.');
    console.log('4. Run "az login" in your terminal if running locally.');
  }
}

runDiagnostics().catch(console.error);

