#!/usr/bin/env node

/**
 * Test script for IoT Hub device registration
 * Run this to test the IoT Hub service functionality
 */

const IoTHubService = require('./iot-service');
const { DefaultAzureCredential } = require('@azure/identity');

async function testIoTHubRegistration() {
  console.log('🧪 Testing IoT Hub Device Registration');
  console.log('=====================================');

  // Test with mock mode (no Azure credentials)
  console.log('\n1. Testing Mock Mode (no Azure credentials):');

  const mockService = new IoTHubService(
    null, // No subscription ID
    null, // No resource group
    null, // No IoT Hub name
    null  // No credentials
  );

  await mockService.initialize();

  try {
    const result = await mockService.registerDevice('test-device-123');
    console.log('✅ Mock registration successful:');
    console.log('   Device ID:', result.deviceId);
    console.log('   Status:', result.status);
    console.log('   Mock mode:', result.mock);
    console.log('   Connection string preview:', result.connectionString.substring(0, 50) + '...');
  } catch (error) {
    console.log('❌ Mock registration failed:', error.message);
  }

  console.log('\n2. Testing with Azure credentials (if available):');

  // Test with actual Azure credentials if environment variables are set
  const subscriptionId = process.env.IOT_HUB_SUBSCRIPTION_ID;
  const resourceGroup = process.env.IOT_HUB_RESOURCE_GROUP || 'EspaTvResourceGroup';
  const iotHubName = process.env.IOT_HUB_NAME || 'espa-tv-iot-hub';

  if (subscriptionId) {
    console.log('   Azure credentials found, testing real IoT Hub connection...');

    const realService = new IoTHubService(
      subscriptionId,
      resourceGroup,
      iotHubName,
      new DefaultAzureCredential()
    );

    await realService.initialize();

    try {
      const realResult = await realService.registerDevice('test-device-real');
      console.log('✅ Real IoT Hub registration successful:');
      console.log('   Device ID:', realResult.deviceId);
      console.log('   Status:', realResult.status);
      console.log('   Created:', realResult.created);
    } catch (error) {
      console.log('❌ Real IoT Hub registration failed:', error.message);
      console.log('   This is expected if IoT Hub permissions are not configured yet');
    }
  } else {
    console.log('   No Azure credentials found (IOT_HUB_SUBSCRIPTION_ID not set)');
    console.log('   To test with real Azure IoT Hub, set these environment variables:');
    console.log('   - IOT_HUB_SUBSCRIPTION_ID');
    console.log('   - IOT_HUB_RESOURCE_GROUP (optional, defaults to EspaTvResourceGroup)');
    console.log('   - IOT_HUB_NAME (optional, defaults to espa-tv-iot-hub)');
  }

  console.log('\n🎉 IoT Hub service test completed!');
}

// Run the test
testIoTHubRegistration().catch(console.error);
